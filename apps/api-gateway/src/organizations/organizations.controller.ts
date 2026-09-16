import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
  USER_SUCCESS_MESSAGES,
  PaginationQueryDto,
  type PaginatedResult,
} from '@app/common';
import { AUTH_PATTERNS, CHAT_PATTERNS, USER_PATTERNS } from '@app/contracts';
import type {
  BillingCheckoutResult,
  BillingPortalResult,
  ConversationView,
  DeleteOrganizationResult,
  LeaveOrganizationResult,
  OrgMemberView,
  OrgSsoView,
  OrganizationView,
} from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { AuditLoggerService } from '../infrastructure/audit/audit-logger.service';
import { SkipOrg } from './skip-org.decorator';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { DeleteOrganizationDto } from './dto/delete-organization.dto';
import {
  SetOrgMemberRoleDto,
  TransferOwnershipDto,
  UpdateOrgBillingDto,
  CreateBillingCheckoutDto,
  UpdateOrganizationDto,
  UpdateOrgSsoDto,
} from './dto/org-manage.dto';

@ApiTags('Organizations')
@ApiBearerAuth()
@Controller('organizations')
@SkipOrg()
export class OrganizationsController {
  private readonly logger = new Logger(OrganizationsController.name);

  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly config: ConfigService,
    private readonly audit: AuditLoggerService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.proxy.sendAuth<OrganizationView[]>(
      AUTH_PATTERNS.LIST_ORGANIZATIONS,
      { userId: user.id },
      { skipTenant: true },
    );
    return { message: 'Organizations retrieved successfully', data };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrganizationDto,
  ) {
    const data = await this.proxy.sendAuth<OrganizationView>(
      AUTH_PATTERNS.CREATE_ORGANIZATION,
      {
        userId: user.id,
        name: dto.name,
        slug: dto.slug,
      },
      { skipTenant: true },
    );

    const nameParts = (user.email.split('@')[0] || 'User').split(/[._-]/);
    await this.proxy.sendUser(
      USER_PATTERNS.CREATE_PROFILE,
      {
        userId: user.id,
        email: user.email,
        firstName: nameParts[0] || 'User',
        lastName: nameParts.slice(1).join(' ') || 'Account',
        organizationId: data.id,
      },
      { skipTenant: true },
    );

    try {
      await this.proxy.sendChat<ConversationView>(
        CHAT_PATTERNS.CREATE_GROUP,
        {
          actorId: user.id,
          name: 'general',
          memberIds: [],
          organizationId: data.id,
        },
        { skipTenant: true },
      );
    } catch (error) {
      this.logger.warn(
        `Could not seed #general for org ${data.id}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }

    this.audit.log({
      actorId: user.id,
      organizationId: data.id,
      action: 'org.created',
      targetType: 'organization',
      targetId: data.id,
      meta: { slug: data.slug, name: data.name },
    });

    return { message: 'Organization created successfully', data };
  }

  @Get(':organizationId/members')
  async listMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    const data = await this.proxy.sendAuth<PaginatedResult<OrgMemberView>>(
      AUTH_PATTERNS.LIST_ORG_MEMBERS,
      {
        organizationId,
        requestedByUserId: user.id,
        page: query.page,
        limit: query.limit,
        search: query.search,
      },
      { skipTenant: true },
    );
    return { message: 'Workspace members', data };
  }

  @Patch(':organizationId/members/:userId')
  async setMemberRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetOrgMemberRoleDto,
  ) {
    const data = await this.proxy.sendAuth<OrgMemberView>(
      AUTH_PATTERNS.SET_ORG_MEMBER_ROLE,
      {
        organizationId,
        actorId: user.id,
        memberId: userId,
        role: dto.role,
      },
      { skipTenant: true },
    );
    this.audit.log({
      actorId: user.id,
      organizationId,
      action: 'member.role_changed',
      targetType: 'user',
      targetId: userId,
      meta: { role: data.role },
    });
    return { message: 'Member role updated', data };
  }

  @Delete(':organizationId/members/:userId')
  async removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const data = await this.proxy.sendAuth<{ removed: boolean }>(
      AUTH_PATTERNS.REMOVE_ORG_MEMBER,
      {
        organizationId,
        actorId: user.id,
        memberId: userId,
      },
      { skipTenant: true },
    );
    try {
      await this.proxy.sendUser(
        USER_PATTERNS.REMOVE,
        { userId, organizationId },
        { skipTenant: true },
      );
    } catch (error) {
      this.logger.warn(
        `Could not remove profile for kicked member ${userId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
    this.audit.log({
      actorId: user.id,
      organizationId,
      action: 'member.removed',
      targetType: 'user',
      targetId: userId,
    });
    return { message: 'Member removed', data };
  }

  @Post(':organizationId/transfer-ownership')
  async transferOwnership(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: TransferOwnershipDto,
  ) {
    const data = await this.proxy.sendAuth<OrganizationView>(
      AUTH_PATTERNS.TRANSFER_OWNERSHIP,
      {
        organizationId,
        actorId: user.id,
        newOwnerUserId: dto.userId,
      },
      { skipTenant: true },
    );
    this.audit.log({
      actorId: user.id,
      organizationId,
      action: 'org.ownership_transferred',
      targetType: 'user',
      targetId: dto.userId,
    });
    return { message: 'Ownership transferred', data };
  }

  @Patch(':organizationId/billing')
  async updateBilling(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: UpdateOrgBillingDto,
  ) {
    const data = await this.proxy.sendAuth<OrganizationView>(
      AUTH_PATTERNS.UPDATE_ORG_BILLING,
      {
        organizationId,
        actorId: user.id,
        plan: dto.plan,
        maxSeats: dto.maxSeats,
      },
      { skipTenant: true },
    );
    this.audit.log({
      actorId: user.id,
      organizationId,
      action: 'org.billing_updated',
      targetType: 'organization',
      targetId: organizationId,
      meta: {
        plan: data.plan,
        maxSeats: data.maxSeats,
      },
    });
    return { message: 'Billing updated', data };
  }

  @Post(':organizationId/billing/checkout')
  async createBillingCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateBillingCheckoutDto,
  ) {
    const publicUrl = (
      this.config.get<string>('APP_PUBLIC_URL') || 'http://localhost:5173'
    ).replace(/\/$/, '');
    const data = await this.proxy.sendAuth<BillingCheckoutResult>(
      AUTH_PATTERNS.CREATE_BILLING_CHECKOUT,
      {
        organizationId,
        actorId: user.id,
        plan: dto.plan,
        successUrl: `${publicUrl}/profile?billing=success`,
        cancelUrl: `${publicUrl}/profile?billing=cancel`,
      },
      { skipTenant: true },
    );
    this.audit.log({
      actorId: user.id,
      organizationId,
      action: 'org.billing_checkout_started',
      targetType: 'organization',
      targetId: organizationId,
      meta: { plan: dto.plan },
    });
    return { message: 'Checkout session created', data };
  }

  @Post(':organizationId/billing/portal')
  async createBillingPortal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    const publicUrl = (
      this.config.get<string>('APP_PUBLIC_URL') ||
      this.config.get<string>('FRONTEND_URL') ||
      'http://localhost:5173'
    ).replace(/\/$/, '');
    const data = await this.proxy.sendAuth<BillingPortalResult>(
      AUTH_PATTERNS.CREATE_BILLING_PORTAL,
      {
        organizationId,
        actorId: user.id,
        returnUrl: `${publicUrl}/profile?billing=portal`,
      },
      { skipTenant: true },
    );
    this.audit.log({
      actorId: user.id,
      organizationId,
      action: 'org.billing_portal_opened',
      targetType: 'organization',
      targetId: organizationId,
    });
    return { message: 'Billing portal session created', data };
  }

  @Patch(':organizationId/sso')
  async updateSso(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: UpdateOrgSsoDto,
  ) {
    const data = await this.proxy.sendAuth<OrgSsoView>(
      AUTH_PATTERNS.UPDATE_ORG_SSO,
      {
        organizationId,
        actorId: user.id,
        ssoEnabled: dto.ssoEnabled,
        ssoProvider: dto.ssoProvider,
        ssoIssuerUrl: dto.ssoIssuerUrl,
        ssoClientId: dto.ssoClientId,
        ssoClientSecret: dto.ssoClientSecret,
        ssoIdpSsoUrl: dto.ssoIdpSsoUrl,
        ssoIdpCertificate: dto.ssoIdpCertificate,
      },
      { skipTenant: true },
    );
    this.audit.log({
      actorId: user.id,
      organizationId,
      action: 'org.sso_updated',
      targetType: 'organization',
      targetId: organizationId,
      meta: {
        ssoEnabled: data.ssoEnabled,
        ssoProvider: data.ssoProvider,
        configured: data.configured,
        secretRotated: Boolean(dto.ssoClientSecret?.trim()),
        certificateRotated: Boolean(dto.ssoIdpCertificate?.trim()),
      },
    });
    return { message: 'SSO settings updated', data };
  }

  @Get(':organizationId/sso')
  async getSso(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    const data = await this.proxy.sendAuth<OrgSsoView>(
      AUTH_PATTERNS.GET_ORG_SSO,
      {
        organizationId,
        userId: user.id,
      },
      { skipTenant: true },
    );
    return { message: 'SSO settings retrieved', data };
  }

  @Patch(':organizationId')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    const data = await this.proxy.sendAuth<OrganizationView>(
      AUTH_PATTERNS.UPDATE_ORGANIZATION,
      {
        organizationId,
        actorId: user.id,
        name: dto.name,
      },
      { skipTenant: true },
    );
    this.audit.log({
      actorId: user.id,
      organizationId,
      action: 'org.renamed',
      targetType: 'organization',
      targetId: organizationId,
      meta: { name: data.name },
    });
    return { message: 'Workspace updated', data };
  }

  @Post(':organizationId/leave')
  async leave(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    const data = await this.proxy.sendAuth<LeaveOrganizationResult>(
      AUTH_PATTERNS.LEAVE_ORGANIZATION,
      { userId: user.id, organizationId },
      { skipTenant: true },
    );

    try {
      await this.proxy.sendUser(
        USER_PATTERNS.REMOVE,
        { userId: user.id, organizationId },
        { skipTenant: true },
      );
    } catch (error) {
      this.logger.warn(
        `Could not remove profile after leaving org ${organizationId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }

    this.logger.log(`User ${user.id} left workspace ${organizationId}`);
    this.audit.log({
      actorId: user.id,
      organizationId,
      action: 'member.left',
      targetType: 'user',
      targetId: user.id,
    });
    return { message: 'Left workspace', data };
  }

  @Delete(':organizationId')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: DeleteOrganizationDto,
  ) {
    const data = await this.proxy.sendAuth<DeleteOrganizationResult>(
      AUTH_PATTERNS.DELETE_ORGANIZATION,
      {
        userId: user.id,
        organizationId,
        confirmName: dto.confirmName,
      },
      { skipTenant: true },
    );

    try {
      await this.proxy.sendUser(
        USER_PATTERNS.PURGE_BY_ORGANIZATION,
        { organizationId, actorId: user.id },
        { skipTenant: true },
      );
    } catch (error) {
      this.logger.warn(
        `Could not purge user profiles for org ${organizationId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }

    try {
      await this.proxy.sendChat(
        CHAT_PATTERNS.PURGE_ORGANIZATION,
        { organizationId, actorId: user.id },
        { skipTenant: true },
      );
    } catch (error) {
      this.logger.warn(
        `Could not purge chat data for org ${organizationId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }

    this.logger.warn(
      `Workspace ${organizationId} deleted by user ${user.id}`,
    );
    this.audit.log({
      actorId: user.id,
      organizationId,
      action: 'org.deleted',
      targetType: 'organization',
      targetId: organizationId,
    });
    return { message: 'Workspace deleted', data };
  }

  @Get(':organizationId')
  @ApiHeader({
    name: 'X-Organization-Id',
    required: false,
    description: 'Optional when reading your own membership by id',
  })
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    const data = await this.proxy.sendAuth<OrganizationView>(
      AUTH_PATTERNS.GET_ORGANIZATION,
      { userId: user.id, organizationId },
      { skipTenant: true },
    );
    return { message: USER_SUCCESS_MESSAGES.PROFILE_FETCHED, data };
  }
}
