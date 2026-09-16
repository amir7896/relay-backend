import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';
import { RpcErrors, UserRole, buildPaginatedResult, getSkipTake } from '@app/common';
import type { PaginatedResult } from '@app/common';
import type {
  AddOrgMemberPayload,
  ApplyStripeSubscriptionPayload,
  BillingCheckoutResult,
  BillingPortalResult,
  CreateBillingCheckoutPayload,
  CreateBillingPortalPayload,
  CreateOrganizationPayload,
  DeleteOrganizationPayload,
  DeleteOrganizationResult,
  EnsureDefaultOrganizationPayload,
  GetOrganizationPayload,
  HandleStripeWebhookPayload,
  LeaveOrganizationPayload,
  LeaveOrganizationResult,
  ListOrganizationsPayload,
  ListOrgMembersPayload,
  OrgMemberView,
  OrgSsoView,
  OrganizationView,
  RemoveOrgMemberPayload,
  ResolveTenantPayload,
  SetOrgMemberRolePayload,
  TransferOwnershipPayload,
  UpdateOrgBillingPayload,
  UpdateOrganizationPayload,
  UpdateOrgSsoPayload,
} from '@app/contracts';
import { Organization } from '../database/entities/organization.entity';
import {
  OrganizationMember,
  type OrgMemberRole,
} from '../database/entities/organization-member.entity';
import { AuthUser } from '../database/entities/auth-user.entity';
import {
  AuthToken,
  AuthTokenType,
} from '../database/entities/auth-token.entity';

const PLAN_DEFAULT_SEATS: Record<'free' | 'pro' | 'enterprise', number> = {
  free: 25,
  pro: 100,
  enterprise: 1000,
};

@Injectable()
export class OrganizationService {
  private readonly logger = new Logger(OrganizationService.name);

  constructor(
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(OrganizationMember)
    private readonly members: Repository<OrganizationMember>,
    @InjectRepository(AuthUser)
    private readonly users: Repository<AuthUser>,
    @InjectRepository(AuthToken)
    private readonly tokens: Repository<AuthToken>,
    private readonly config: ConfigService,
  ) {}

  async ensureDefaultOrganization(
    _payload: EnsureDefaultOrganizationPayload = {},
  ): Promise<OrganizationView> {
    let org = await this.organizations.findOne({
      where: { isDefault: true },
    });
    if (!org) {
      org = await this.organizations.findOne({
        where: { slug: 'default' },
      });
    }
    if (!org) {
      org = await this.organizations.save(
        this.organizations.create({
          slug: 'default',
          name: 'Relay',
          status: 'active',
          isDefault: true,
        }),
      );
      this.logger.log('Created default organization (shared DB tenancy)');
    }

    // Slack-style: only bootstrap platform admins into the default workspace.
    // Regular users create or join a workspace after signup.
    const admins = await this.users.find({
      where: { role: UserRole.ADMIN },
      select: { id: true, role: true },
    });
    for (const user of admins) {
      const existing = await this.members.findOne({
        where: { organizationId: org.id, userId: user.id },
      });
      if (existing) {
        continue;
      }
      await this.members.save(
        this.members.create({
          organizationId: org.id,
          userId: user.id,
          role: 'owner',
        }),
      );
    }

    return this.toView(org);
  }

  async createOrganization(
    payload: CreateOrganizationPayload,
  ): Promise<OrganizationView> {
    const name = payload.name.trim();
    if (!name) {
      return RpcErrors.badRequest('Organization name is required');
    }
    const slug = this.normalizeSlug(payload.slug || name);
    const existingSlug = await this.organizations.findOne({ where: { slug } });
    if (existingSlug) {
      return RpcErrors.conflict('Organization slug already exists');
    }

    const org = await this.organizations.save(
      this.organizations.create({
        slug,
        name,
        status: 'active',
        isDefault: false,
      }),
    );

    await this.members.save(
      this.members.create({
        organizationId: org.id,
        userId: payload.userId,
        role: 'owner',
      }),
    );

    return this.toView(org, 'owner');
  }

  async listForUser(
    payload: ListOrganizationsPayload,
  ): Promise<OrganizationView[]> {
    const rows = await this.members.find({
      where: { userId: payload.userId },
      relations: { organization: true },
      order: { createdAt: 'ASC' },
    });
    const active = rows.filter((row) => row.organization?.status === 'active');
    return Promise.all(
      active.map((row) => this.toView(row.organization, row.role)),
    );
  }

  async getForUser(
    payload: GetOrganizationPayload,
  ): Promise<OrganizationView> {
    const membership = await this.members.findOne({
      where: {
        organizationId: payload.organizationId,
        userId: payload.userId,
      },
      relations: { organization: true },
    });
    if (!membership?.organization) {
      return RpcErrors.notFound('Organization');
    }
    return this.toView(membership.organization, membership.role);
  }

  async assertSeatAvailable(
    organizationId: string,
    options?: { role?: OrgMemberRole },
  ): Promise<void> {
    // Guests do not consume billed seats.
    if (options?.role === 'guest') {
      return;
    }
    const org = await this.organizations.findOne({
      where: { id: organizationId },
    });
    if (!org) {
      return RpcErrors.notFound('Organization');
    }
    const seatCount = await this.members.count({
      where: [
        { organizationId, role: 'owner' },
        { organizationId, role: 'admin' },
        { organizationId, role: 'member' },
      ],
    });
    if (seatCount >= org.maxSeats) {
      return RpcErrors.conflict(
        `This workspace has reached its seat limit (${org.maxSeats}). Upgrade your plan to add more members.`,
      );
    }
  }

  async resolveTenant(
    payload: ResolveTenantPayload,
  ): Promise<OrganizationView> {
    return this.getForUser(payload);
  }

  async addMember(payload: AddOrgMemberPayload): Promise<{ ok: true }> {
    const actor = await this.members.findOne({
      where: {
        organizationId: payload.organizationId,
        userId: payload.actorId,
      },
    });
    if (!actor || (actor.role !== 'owner' && actor.role !== 'admin')) {
      return RpcErrors.forbidden('Only org admins can add members');
    }
    return this.addMemberDirect({
      organizationId: payload.organizationId,
      userId: payload.userId,
      role: payload.role ?? 'member',
    });
  }

  /** Used by invite acceptance — no actor permission check. */
  async addMemberDirect(input: {
    organizationId: string;
    userId: string;
    role?: OrgMemberRole;
  }): Promise<{ ok: true }> {
    const existing = await this.members.findOne({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    });
    if (existing) {
      return { ok: true };
    }
    await this.assertSeatAvailable(input.organizationId, {
      role: input.role ?? 'member',
    });
    await this.members.save(
      this.members.create({
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role ?? 'member',
      }),
    );
    return { ok: true };
  }

  async isMember(input: {
    organizationId: string;
    userId: string;
  }): Promise<boolean> {
    const existing = await this.members.findOne({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
      select: { id: true },
    });
    return Boolean(existing);
  }

  async requireOrgAdmin(input: {
    organizationId: string;
    userId: string;
  }): Promise<OrganizationView> {
    const membership = await this.members.findOne({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
      relations: { organization: true },
    });
    if (!membership?.organization) {
      return RpcErrors.notFound('Organization');
    }
    if (membership.role !== 'owner' && membership.role !== 'admin') {
      return RpcErrors.forbidden('Only workspace owners/admins can manage invites');
    }
    return this.toView(membership.organization, membership.role);
  }

  async deleteOrganization(
    payload: DeleteOrganizationPayload,
  ): Promise<DeleteOrganizationResult> {
    const membership = await this.members.findOne({
      where: {
        organizationId: payload.organizationId,
        userId: payload.userId,
      },
      relations: { organization: true },
    });
    if (!membership?.organization) {
      return RpcErrors.notFound('Organization');
    }
    if (membership.role !== 'owner') {
      return RpcErrors.forbidden('Only the workspace owner can delete this workspace');
    }
    if (membership.organization.isDefault) {
      return RpcErrors.forbidden('The platform default workspace cannot be deleted');
    }

    const expected = membership.organization.name.trim();
    const provided = payload.confirmName?.trim() ?? '';
    if (!provided || provided.toLowerCase() !== expected.toLowerCase()) {
      return RpcErrors.badRequest(
        `Type the workspace name "${expected}" to confirm deletion`,
      );
    }

    const organizationId = membership.organization.id;
    await this.tokens.delete({
      type: AuthTokenType.INVITE,
      organizationId,
    });
    await this.organizations.delete({ id: organizationId });
    this.logger.warn(
      `Workspace deleted | id=${organizationId} | by=${payload.userId}`,
    );

    const remainingOrganizations = await this.listForUser({
      userId: payload.userId,
    });
    return {
      deletedOrganizationId: organizationId,
      remainingOrganizations,
    };
  }

  async leaveOrganization(
    payload: LeaveOrganizationPayload,
  ): Promise<LeaveOrganizationResult> {
    const membership = await this.members.findOne({
      where: {
        organizationId: payload.organizationId,
        userId: payload.userId,
      },
      relations: { organization: true },
    });
    if (!membership?.organization) {
      return RpcErrors.notFound('Organization');
    }
    if (membership.organization.status !== 'active') {
      return RpcErrors.badRequest('This workspace is not active');
    }

    if (membership.role === 'owner') {
      const ownerCount = await this.members.count({
        where: {
          organizationId: payload.organizationId,
          role: 'owner',
        },
      });
      if (ownerCount <= 1) {
        return RpcErrors.forbidden(
          'You are the only owner. Transfer ownership or delete the workspace instead.',
        );
      }
    }

    await this.members.delete({ id: membership.id });
    this.logger.log(
      `User left workspace | org=${payload.organizationId} | user=${payload.userId}`,
    );

    const remainingOrganizations = await this.listForUser({
      userId: payload.userId,
    });
    return {
      leftOrganizationId: payload.organizationId,
      remainingOrganizations,
    };
  }

  async listMembers(
    payload: ListOrgMembersPayload,
  ): Promise<PaginatedResult<OrgMemberView>> {
    await this.requireOrgAdmin({
      organizationId: payload.organizationId,
      userId: payload.requestedByUserId,
    });
    const page = Math.max(1, Number(payload.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(payload.limit) || 20));
    const { skip, take } = getSkipTake(page, limit);

    const qb = this.members
      .createQueryBuilder('member')
      .where('member.organizationId = :organizationId', {
        organizationId: payload.organizationId,
      })
      .orderBy('member.createdAt', 'ASC')
      .skip(skip)
      .take(take);

    const search = payload.search?.trim();
    if (search) {
      qb.innerJoin(
        AuthUser,
        'user',
        'user.id = member.userId AND user.deletedAt IS NULL',
      ).andWhere('user.email ILIKE :search', { search: `%${search}%` });
    }

    const [rows, total] = await qb.getManyAndCount();
    return buildPaginatedResult(
      rows.map((row) => ({
        userId: row.userId,
        role: row.role,
        joinedAt: row.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
    );
  }

  async setMemberRole(
    payload: SetOrgMemberRolePayload,
  ): Promise<OrgMemberView> {
    const actor = await this.members.findOne({
      where: {
        organizationId: payload.organizationId,
        userId: payload.actorId,
      },
    });
    if (!actor || actor.role !== 'owner') {
      return RpcErrors.forbidden('Only the workspace owner can change roles');
    }
    if (payload.actorId === payload.memberId) {
      return RpcErrors.badRequest('You cannot change your own role');
    }
    const member = await this.members.findOne({
      where: {
        organizationId: payload.organizationId,
        userId: payload.memberId,
      },
    });
    if (!member) {
      return RpcErrors.notFound('Member');
    }
    if (member.role === 'owner') {
      return RpcErrors.forbidden('Use transfer ownership to change the owner');
    }
    const becomingBillable =
      payload.role !== 'guest' && member.role === 'guest';
    if (becomingBillable) {
      await this.assertSeatAvailable(payload.organizationId, {
        role: payload.role,
      });
    }
    member.role = payload.role;
    const saved = await this.members.save(member);
    return {
      userId: saved.userId,
      role: saved.role,
      joinedAt: saved.createdAt.toISOString(),
    };
  }

  async removeMember(
    payload: RemoveOrgMemberPayload,
  ): Promise<{ removed: boolean }> {
    const actor = await this.members.findOne({
      where: {
        organizationId: payload.organizationId,
        userId: payload.actorId,
      },
    });
    if (!actor || (actor.role !== 'owner' && actor.role !== 'admin')) {
      return RpcErrors.forbidden('Only workspace owners/admins can remove members');
    }
    if (payload.actorId === payload.memberId) {
      return RpcErrors.badRequest('Use leave workspace to remove yourself');
    }
    const member = await this.members.findOne({
      where: {
        organizationId: payload.organizationId,
        userId: payload.memberId,
      },
    });
    if (!member) {
      return RpcErrors.notFound('Member');
    }
    if (member.role === 'owner') {
      return RpcErrors.forbidden('Cannot remove a workspace owner');
    }
    if (actor.role === 'admin' && member.role === 'admin') {
      return RpcErrors.forbidden('Admins cannot remove other admins');
    }
    await this.members.delete({ id: member.id });
    return { removed: true };
  }

  async updateOrganization(
    payload: UpdateOrganizationPayload,
  ): Promise<OrganizationView> {
    const membership = await this.requireOrgAdmin({
      organizationId: payload.organizationId,
      userId: payload.actorId,
    });
    const name = payload.name.trim();
    if (name.length < 2) {
      return RpcErrors.badRequest('Workspace name must be at least 2 characters');
    }
    const org = await this.organizations.findOne({
      where: { id: payload.organizationId },
    });
    if (!org) {
      return RpcErrors.notFound('Organization');
    }
    org.name = name.slice(0, 120);
    const saved = await this.organizations.save(org);
    return this.toView(saved, membership.role);
  }

  async transferOwnership(
    payload: TransferOwnershipPayload,
  ): Promise<OrganizationView> {
    const actor = await this.members.findOne({
      where: {
        organizationId: payload.organizationId,
        userId: payload.actorId,
      },
      relations: { organization: true },
    });
    if (!actor?.organization || actor.role !== 'owner') {
      return RpcErrors.forbidden('Only the workspace owner can transfer ownership');
    }
    if (payload.actorId === payload.newOwnerUserId) {
      return RpcErrors.badRequest('You already own this workspace');
    }
    const target = await this.members.findOne({
      where: {
        organizationId: payload.organizationId,
        userId: payload.newOwnerUserId,
      },
    });
    if (!target) {
      return RpcErrors.notFound('Member');
    }

    target.role = 'owner';
    actor.role = 'admin';
    await this.members.save([target, actor]);
    this.logger.warn(
      `Ownership transferred | org=${payload.organizationId} | from=${payload.actorId} | to=${payload.newOwnerUserId}`,
    );
    return this.toView(actor.organization, 'admin');
  }

  async updateBilling(
    payload: UpdateOrgBillingPayload,
  ): Promise<OrganizationView> {
    const membership = await this.members.findOne({
      where: {
        organizationId: payload.organizationId,
        userId: payload.actorId,
      },
    });
    if (!membership || membership.role !== 'owner') {
      return RpcErrors.forbidden('Only the workspace owner can update billing');
    }
    const org = await this.organizations.findOne({
      where: { id: payload.organizationId },
    });
    if (!org) {
      return RpcErrors.notFound('Organization');
    }

    if (payload.plan) {
      org.plan = payload.plan;
      if (payload.maxSeats === undefined) {
        org.maxSeats = PLAN_DEFAULT_SEATS[payload.plan];
      }
    }
    if (payload.maxSeats !== undefined) {
      if (payload.maxSeats < 1) {
        return RpcErrors.badRequest('maxSeats must be at least 1');
      }
      org.maxSeats = payload.maxSeats;
    }

    const saved = await this.organizations.save(org);
    return this.toView(saved, membership.role);
  }

  async createCheckoutSession(
    payload: CreateBillingCheckoutPayload,
  ): Promise<BillingCheckoutResult> {
    const membership = await this.members.findOne({
      where: {
        organizationId: payload.organizationId,
        userId: payload.actorId,
      },
    });
    if (!membership || membership.role !== 'owner') {
      return RpcErrors.forbidden(
        'Only the workspace owner can manage billing',
      );
    }

    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    const pricePro = this.config.get<string>('STRIPE_PRICE_PRO')?.trim();
    const priceEnterprise = this.config
      .get<string>('STRIPE_PRICE_ENTERPRISE')
      ?.trim();
    if (!secretKey || !pricePro || !priceEnterprise) {
      return RpcErrors.serviceUnavailable(
        'Stripe billing is not configured. Set STRIPE_SECRET_KEY, STRIPE_PRICE_PRO, and STRIPE_PRICE_ENTERPRISE.',
      );
    }

    const priceId = payload.plan === 'pro' ? pricePro : priceEnterprise;
    const org = await this.organizations.findOne({
      where: { id: payload.organizationId },
    });
    if (!org) {
      return RpcErrors.notFound('Organization');
    }

    const actor = await this.users.findOne({
      where: { id: payload.actorId },
      select: { id: true, email: true },
    });
    const stripe = new Stripe(secretKey);

    let customerId = org.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: actor?.email,
        name: org.name,
        metadata: {
          organizationId: org.id,
        },
      });
      customerId = customer.id;
      org.stripeCustomerId = customerId;
      await this.organizations.save(org);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: payload.successUrl,
      cancel_url: payload.cancelUrl,
      metadata: {
        organizationId: org.id,
        plan: payload.plan,
      },
      subscription_data: {
        metadata: {
          organizationId: org.id,
          plan: payload.plan,
        },
      },
    });

    if (!session.url) {
      return RpcErrors.internal('Stripe did not return a checkout URL');
    }
    return { url: session.url };
  }

  async createBillingPortalSession(
    payload: CreateBillingPortalPayload,
  ): Promise<BillingPortalResult> {
    const membership = await this.members.findOne({
      where: {
        organizationId: payload.organizationId,
        userId: payload.actorId,
      },
    });
    if (!membership || membership.role !== 'owner') {
      return RpcErrors.forbidden(
        'Only the workspace owner can manage billing',
      );
    }

    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    if (!secretKey) {
      return RpcErrors.serviceUnavailable(
        'Stripe billing is not configured. Set STRIPE_SECRET_KEY.',
      );
    }

    const org = await this.organizations.findOne({
      where: { id: payload.organizationId },
    });
    if (!org) {
      return RpcErrors.notFound('Organization');
    }
    if (!org.stripeCustomerId) {
      return RpcErrors.badRequest(
        'No Stripe customer yet. Upgrade with Checkout first.',
      );
    }

    const stripe = new Stripe(secretKey);
    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: payload.returnUrl,
    });
    if (!session.url) {
      return RpcErrors.internal('Stripe did not return a portal URL');
    }
    return { url: session.url };
  }

  async applyStripeSubscription(
    payload: ApplyStripeSubscriptionPayload,
  ): Promise<{ updated: boolean }> {
    const org = await this.organizations.findOne({
      where: { stripeCustomerId: payload.customerId },
    });
    if (!org) {
      this.logger.warn(
        `Stripe subscription update for unknown customer ${payload.customerId}`,
      );
      return { updated: false };
    }

    const canceled =
      payload.status === 'canceled' ||
      payload.status === 'unpaid' ||
      !payload.subscriptionId;

    if (canceled) {
      org.stripeSubscriptionId = null;
      org.stripePriceId = null;
      org.plan = 'free';
      org.maxSeats = PLAN_DEFAULT_SEATS.free;
      await this.organizations.save(org);
      return { updated: true };
    }

    org.stripeSubscriptionId = payload.subscriptionId;
    org.stripePriceId = payload.priceId;

    const pricePro = this.config.get<string>('STRIPE_PRICE_PRO')?.trim();
    const priceEnterprise = this.config
      .get<string>('STRIPE_PRICE_ENTERPRISE')
      ?.trim();
    let plan: 'pro' | 'enterprise' | 'free' = org.plan;
    if (payload.priceId && pricePro && payload.priceId === pricePro) {
      plan = 'pro';
    } else if (
      payload.priceId &&
      priceEnterprise &&
      payload.priceId === priceEnterprise
    ) {
      plan = 'enterprise';
    } else if (payload.status === 'active' || payload.status === 'trialing') {
      // Keep existing plan if price mapping unknown; default to pro seats
      if (org.plan === 'free') {
        plan = 'pro';
      }
    }
    org.plan = plan;
    org.maxSeats = PLAN_DEFAULT_SEATS[plan];
    await this.organizations.save(org);
    return { updated: true };
  }

  async handleStripeWebhook(
    payload: HandleStripeWebhookPayload,
  ): Promise<{ received: true; handled: boolean }> {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    const webhookSecret = this.config
      .get<string>('STRIPE_WEBHOOK_SECRET')
      ?.trim();

    let type = payload.type;
    let dataObject: Record<string, unknown> | undefined =
      (payload.data?.object as Record<string, unknown> | undefined) ??
      (payload.data as Record<string, unknown> | undefined);

    if (webhookSecret) {
      if (!secretKey) {
        return RpcErrors.serviceUnavailable(
          'STRIPE_SECRET_KEY is required when STRIPE_WEBHOOK_SECRET is set',
        );
      }
      if (!payload.rawBody || !payload.signature) {
        return RpcErrors.badRequest(
          'Stripe webhook requires raw body and stripe-signature header',
        );
      }
      const stripe = new Stripe(secretKey);
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          payload.rawBody,
          payload.signature,
          webhookSecret,
        );
      } catch (error) {
        return RpcErrors.badRequest(
          error instanceof Error
            ? error.message
            : 'Invalid Stripe webhook signature',
        );
      }
      type = event.type;
      dataObject = event.data.object as unknown as Record<string, unknown>;
    } else if (!type || !dataObject) {
      return RpcErrors.badRequest(
        'Dev webhook requires type and data (or set STRIPE_WEBHOOK_SECRET)',
      );
    }

    const handled = await this.applyStripeEvent(type!, dataObject!);
    return { received: true, handled };
  }

  private async applyStripeEvent(
    type: string,
    dataObject: Record<string, unknown>,
  ): Promise<boolean> {
    if (
      type === 'customer.subscription.created' ||
      type === 'customer.subscription.updated' ||
      type === 'customer.subscription.deleted'
    ) {
      const customerId =
        typeof dataObject.customer === 'string'
          ? dataObject.customer
          : undefined;
      const subscriptionId =
        typeof dataObject.id === 'string' ? dataObject.id : null;
      const status =
        typeof dataObject.status === 'string' ? dataObject.status : 'canceled';
      const items = dataObject.items as
        | { data?: Array<{ price?: { id?: string } }> }
        | undefined;
      const priceId = items?.data?.[0]?.price?.id ?? null;
      if (!customerId) {
        return false;
      }
      const result = await this.applyStripeSubscription({
        customerId,
        subscriptionId:
          type === 'customer.subscription.deleted' ? null : subscriptionId,
        priceId,
        status:
          type === 'customer.subscription.deleted' ? 'canceled' : status,
      });
      return result.updated;
    }

    if (type === 'checkout.session.completed') {
      const customerId =
        typeof dataObject.customer === 'string'
          ? dataObject.customer
          : undefined;
      const subscriptionId =
        typeof dataObject.subscription === 'string'
          ? dataObject.subscription
          : null;
      const metadata = dataObject.metadata as
        | { organizationId?: string; plan?: string }
        | undefined;
      const secretKey = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
      if (customerId && subscriptionId && secretKey) {
        const stripe = new Stripe(secretKey);
        const subscription =
          await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items.data[0]?.price?.id ?? null;
        const result = await this.applyStripeSubscription({
          customerId,
          subscriptionId: subscription.id,
          priceId,
          status: subscription.status,
        });
        return result.updated;
      }
      if (customerId) {
        const planHint =
          metadata?.plan === 'enterprise'
            ? this.config.get<string>('STRIPE_PRICE_ENTERPRISE')
            : this.config.get<string>('STRIPE_PRICE_PRO');
        const result = await this.applyStripeSubscription({
          customerId,
          subscriptionId,
          priceId: planHint?.trim() || null,
          status: 'active',
        });
        return result.updated;
      }
      return false;
    }

    return false;
  }

  async updateSso(payload: UpdateOrgSsoPayload): Promise<OrgSsoView> {
    await this.requireOrgAdmin({
      organizationId: payload.organizationId,
      userId: payload.actorId,
    });
    const org = await this.organizations
      .createQueryBuilder('org')
      .addSelect('org.ssoClientSecret')
      .addSelect('org.ssoIdpCertificate')
      .where('org.id = :id', { id: payload.organizationId })
      .getOne();
    if (!org) {
      return RpcErrors.notFound('Organization');
    }

    const plan = org.plan ?? 'free';
    if (payload.ssoEnabled && plan !== 'pro' && plan !== 'enterprise') {
      return RpcErrors.forbidden(
        'SSO requires a Pro or Enterprise plan. Upgrade billing to enable SSO.',
      );
    }

    org.ssoEnabled = payload.ssoEnabled;
    if (payload.ssoProvider !== undefined) {
      org.ssoProvider = payload.ssoProvider;
    }
    if (payload.ssoIssuerUrl !== undefined) {
      org.ssoIssuerUrl = payload.ssoIssuerUrl?.trim() || null;
    }
    if (payload.ssoClientId !== undefined) {
      org.ssoClientId = payload.ssoClientId?.trim() || null;
    }
    if (payload.ssoClientSecret !== undefined) {
      org.ssoClientSecret = payload.ssoClientSecret?.trim() || null;
    }
    if (payload.ssoIdpSsoUrl !== undefined) {
      org.ssoIdpSsoUrl = payload.ssoIdpSsoUrl?.trim() || null;
    }
    if (payload.ssoIdpCertificate !== undefined) {
      org.ssoIdpCertificate = payload.ssoIdpCertificate?.trim() || null;
    }

    const saved = await this.organizations.save(org);
    return this.toSsoView(saved);
  }

  async getSso(input: {
    organizationId: string;
    userId: string;
  }): Promise<OrgSsoView> {
    await this.getForUser({
      organizationId: input.organizationId,
      userId: input.userId,
    });
    const org = await this.organizations
      .createQueryBuilder('org')
      .addSelect('org.ssoClientSecret')
      .addSelect('org.ssoIdpCertificate')
      .where('org.id = :id', { id: input.organizationId })
      .getOne();
    if (!org) {
      return RpcErrors.notFound('Organization');
    }
    return this.toSsoView(org);
  }

  /** Public/gateway: load SSO credentials by organization id (no user auth). */
  async getSsoCredentials(organizationId: string) {
    const org = await this.organizations
      .createQueryBuilder('org')
      .addSelect('org.ssoClientSecret')
      .addSelect('org.ssoIdpCertificate')
      .where('org.id = :id', { id: organizationId })
      .getOne();
    if (!org) {
      return RpcErrors.notFound('Organization');
    }
    const view = this.toSsoView(org);
    return {
      ...view,
      ssoClientSecret: org.ssoClientSecret ?? null,
      ssoIdpCertificate: org.ssoIdpCertificate ?? null,
      slug: org.slug,
      name: org.name,
    };
  }

  /** Resolve org by slug for login SSO picker. */
  async getSsoCredentialsBySlug(slug: string) {
    const normalized = this.normalizeSlug(slug);
    const org = await this.organizations
      .createQueryBuilder('org')
      .addSelect('org.ssoClientSecret')
      .addSelect('org.ssoIdpCertificate')
      .where('org.slug = :slug', { slug: normalized })
      .getOne();
    if (!org) {
      return RpcErrors.notFound('Organization');
    }
    const view = this.toSsoView(org);
    return {
      ...view,
      ssoClientSecret: org.ssoClientSecret ?? null,
      ssoIdpCertificate: org.ssoIdpCertificate ?? null,
      slug: org.slug,
      name: org.name,
    };
  }

  private normalizeSlug(input: string): string {
    const slug = input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    if (!slug) {
      return RpcErrors.badRequest('Invalid organization slug');
    }
    return slug;
  }

  private toSsoView(org: Organization): OrgSsoView {
    const hasClientSecret = Boolean(org.ssoClientSecret);
    const hasIdpCertificate = Boolean(org.ssoIdpCertificate);
    const plan = (org.plan ?? 'free') as 'free' | 'pro' | 'enterprise';
    const paidPlan = plan === 'pro' || plan === 'enterprise';
    const oidcConfigured =
      org.ssoProvider === 'oidc' &&
      Boolean(org.ssoIssuerUrl) &&
      Boolean(org.ssoClientId) &&
      hasClientSecret;
    const samlConfigured =
      org.ssoProvider === 'saml' &&
      Boolean(org.ssoIssuerUrl) &&
      Boolean(org.ssoIdpSsoUrl) &&
      hasIdpCertificate;
    return {
      organizationId: org.id,
      ssoEnabled: Boolean(org.ssoEnabled),
      ssoProvider: org.ssoProvider ?? null,
      ssoIssuerUrl: org.ssoIssuerUrl ?? null,
      ssoClientId: org.ssoClientId ?? null,
      hasClientSecret,
      ssoIdpSsoUrl: org.ssoIdpSsoUrl ?? null,
      hasIdpCertificate,
      plan,
      configured:
        paidPlan && Boolean(org.ssoEnabled) && (oidcConfigured || samlConfigured),
    };
  }

  private async toView(
    org: Organization,
    role?: OrgMemberRole,
  ): Promise<OrganizationView> {
    const seatCount = await this.members.count({
      where: [
        { organizationId: org.id, role: 'owner' },
        { organizationId: org.id, role: 'admin' },
        { organizationId: org.id, role: 'member' },
      ],
    });
    return {
      id: org.id,
      slug: org.slug,
      name: org.name,
      status: org.status,
      isDefault: org.isDefault,
      role,
      plan: org.plan ?? 'free',
      maxSeats: org.maxSeats ?? 25,
      seatCount,
      ssoEnabled: Boolean(org.ssoEnabled),
      createdAt: org.createdAt.toISOString(),
      updatedAt: org.updatedAt.toISOString(),
    };
  }
}
