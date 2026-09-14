import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  AuthenticatedUser,
  CurrentUser,
  ForbiddenAppException,
  Public,
  Roles,
  UserRole,
} from '@app/common';
import type { PaginatedResult } from '@app/common';
import { AUTH_PATTERNS, CHAT_PATTERNS } from '@app/contracts';
import type {
  AuditEventView,
  ChatAnalyticsView,
  OrganizationView,
  WorkspaceSettingsView,
} from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { PresenceService } from '../chat/presence.service';
import { LinkPreviewService } from '../chat/link-preview.service';
import { LinkPreviewDto, UpdateWorkspaceDto } from './dto/admin.dto';
import { ChatPageQueryDto } from '../chat/dto/chat.dto';

const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettingsView = {
  appName: 'Relay',
  tagline: 'Private team messenger',
  primaryColor: '#2563eb',
  logoUrl: null,
};

@Controller()
export class AdminController {
  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly presence: PresenceService,
    private readonly linkPreview: LinkPreviewService,
  ) {}

  @Get('admin/analytics')
  @Roles(UserRole.ADMIN)
  async analytics(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.proxy.sendChat<ChatAnalyticsView>(
      CHAT_PATTERNS.GET_ANALYTICS,
      { actorId: user.id },
    );
    const onlineUsers = await this.presence.countOnlineUsers();
    return {
      message: 'Analytics loaded',
      data: { ...data, onlineUsers },
    };
  }

  @Get('admin/audit')
  @Roles(UserRole.ADMIN)
  async audit(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ChatPageQueryDto,
  ) {
    const data = await this.proxy.sendChat<PaginatedResult<AuditEventView>>(
      CHAT_PATTERNS.LIST_AUDIT,
      { actorId: user.id, page: query.page, limit: query.limit },
    );
    return { message: 'Audit log loaded', data };
  }

  @Get('admin/audit/export')
  @Roles(UserRole.ADMIN)
  async auditExport(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.proxy.sendChat<PaginatedResult<AuditEventView>>(
      CHAT_PATTERNS.LIST_AUDIT,
      { actorId: user.id, page: 1, limit: 500 },
    );
    const header = 'id,actorId,action,targetType,targetId,createdAt\n';
    const rows = data.items
      .map((item) =>
        [
          item.id,
          item.actorId,
          item.action,
          item.targetType ?? '',
          item.targetId ?? '',
          item.createdAt,
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(','),
      )
      .join('\n');
    return {
      message: 'Audit export ready',
      data: { csv: `${header}${rows}` },
    };
  }

  @Get('workspace/settings')
  @Public()
  async workspaceSettings(
    @Headers('x-organization-id') organizationId?: string,
  ) {
    const trimmed = organizationId?.trim();
    // Public branding: without a workspace header return product defaults.
    // Authenticated clients attach X-Organization-Id for per-org branding.
    if (!trimmed) {
      return { message: 'Workspace settings', data: DEFAULT_WORKSPACE_SETTINGS };
    }
    const data = await this.proxy.sendChat<WorkspaceSettingsView>(
      CHAT_PATTERNS.GET_WORKSPACE,
      { organizationId: trimmed },
      { skipTenant: true },
    );
    return { message: 'Workspace settings', data };
  }

  @Patch('workspace/settings')
  async updateWorkspace(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    const orgId = organizationId?.trim();
    if (!orgId) {
      throw new ForbiddenAppException(
        'X-Organization-Id is required to update workspace branding',
      );
    }

    const isPlatformAdmin = user.role === UserRole.ADMIN;
    if (!isPlatformAdmin) {
      try {
        await this.proxy.sendAuth<OrganizationView>(
          AUTH_PATTERNS.GET_ORGANIZATION,
          { userId: user.id, organizationId: orgId },
          { skipTenant: true },
        );
      } catch {
        throw new ForbiddenAppException('Workspace not available');
      }
      // Confirm owner/admin via invite gate helper path: list members requires admin
      await this.proxy.sendAuth(
        AUTH_PATTERNS.LIST_ORG_MEMBERS,
        { organizationId: orgId, requestedByUserId: user.id },
        { skipTenant: true },
      );
    }

    const data = await this.proxy.sendChat<WorkspaceSettingsView>(
      CHAT_PATTERNS.UPDATE_WORKSPACE,
      { actorId: user.id, organizationId: orgId, ...dto },
      { skipTenant: true },
    );
    return { message: 'Workspace updated', data };
  }

  @Post('chat/link-preview')
  @HttpCode(HttpStatus.OK)
  async previewLink(@Body() dto: LinkPreviewDto) {
    const data = await this.linkPreview.fetch(dto.url);
    return { message: 'Link preview ready', data };
  }
}
