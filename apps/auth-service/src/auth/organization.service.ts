import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RpcErrors, UserRole } from '@app/common';
import type {
  AddOrgMemberPayload,
  CreateOrganizationPayload,
  DeleteOrganizationPayload,
  DeleteOrganizationResult,
  EnsureDefaultOrganizationPayload,
  GetOrganizationPayload,
  LeaveOrganizationPayload,
  LeaveOrganizationResult,
  ListOrganizationsPayload,
  ListOrgMembersPayload,
  OrgMemberView,
  OrganizationView,
  RemoveOrgMemberPayload,
  ResolveTenantPayload,
  SetOrgMemberRolePayload,
  TransferOwnershipPayload,
  UpdateOrganizationPayload,
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
    return rows
      .filter((row) => row.organization?.status === 'active')
      .map((row) => this.toView(row.organization, row.role));
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
  ): Promise<OrgMemberView[]> {
    await this.requireOrgAdmin({
      organizationId: payload.organizationId,
      userId: payload.requestedByUserId,
    });
    const rows = await this.members.find({
      where: { organizationId: payload.organizationId },
      order: { createdAt: 'ASC' },
    });
    return rows.map((row) => ({
      userId: row.userId,
      role: row.role,
      joinedAt: row.createdAt.toISOString(),
    }));
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

  private toView(
    org: Organization,
    role?: OrgMemberRole,
  ): OrganizationView {
    return {
      id: org.id,
      slug: org.slug,
      name: org.name,
      status: org.status,
      isDefault: org.isDefault,
      role,
      createdAt: org.createdAt.toISOString(),
      updatedAt: org.updatedAt.toISOString(),
    };
  }
}
