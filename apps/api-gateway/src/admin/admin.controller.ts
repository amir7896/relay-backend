import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import {
  AuthenticatedUser,
  BadRequestAppException,
  CurrentUser,
  ForbiddenAppException,
  Public,
  UserRole,
} from '@app/common';
import type { PaginatedResult } from '@app/common';
import { AUTH_PATTERNS, CHAT_PATTERNS } from '@app/contracts';
import type {
  AuditEventView,
  ChatAnalyticsView,
  OrganizationView,
  RetentionPurgeStatusView,
  WorkspaceSettingsView,
} from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { PresenceService } from '../chat/presence.service';
import { LinkPreviewService } from '../chat/link-preview.service';
import { StorageService } from '../storage/storage.service';
import { LinkPreviewDto, UpdateWorkspaceDto } from './dto/admin.dto';
import { ChatPageQueryDto } from '../chat/dto/chat.dto';

const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettingsView = {
  appName: 'Relay',
  tagline: 'Private team messenger',
  primaryColor: '#2563eb',
  logoUrl: null,
  customEmojis: [],
};

type OrgRequest = Request & { organization?: OrganizationView };

@Controller()
export class AdminController {
  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly presence: PresenceService,
    private readonly linkPreview: LinkPreviewService,
    private readonly storage: StorageService,
  ) {}

  /** Platform admin or workspace owner/admin may use Compliance / Analytics. */
  private assertWorkspaceManager(
    user: AuthenticatedUser,
    request: OrgRequest,
  ) {
    if (user.role === UserRole.ADMIN) {
      return;
    }
    const role = request.organization?.role;
    if (role === 'owner' || role === 'admin') {
      return;
    }
    throw new ForbiddenAppException(
      'Only workspace owners and admins can access compliance and analytics',
    );
  }

  @Get('admin/analytics')
  async analytics(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: OrgRequest,
  ) {
    this.assertWorkspaceManager(user, request);
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
  async audit(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: OrgRequest,
    @Query() query: ChatPageQueryDto,
  ) {
    this.assertWorkspaceManager(user, request);
    const data = await this.proxy.sendChat<PaginatedResult<AuditEventView>>(
      CHAT_PATTERNS.LIST_AUDIT,
      { actorId: user.id, page: query.page, limit: query.limit },
    );
    return { message: 'Audit log loaded', data };
  }

  @Get('admin/audit/export')
  async auditExport(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: OrgRequest,
  ) {
    this.assertWorkspaceManager(user, request);
    const data = await this.proxy.sendChat<PaginatedResult<AuditEventView>>(
      CHAT_PATTERNS.LIST_AUDIT,
      { actorId: user.id, page: 1, limit: 5_000 },
    );
    const header = 'id,actorId,action,targetType,targetId,meta,createdAt\n';
    const rows = data.items
      .map((item) =>
        [
          item.id,
          item.actorId,
          item.action,
          item.targetType ?? '',
          item.targetId ?? '',
          JSON.stringify(item.meta ?? {}),
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

  @Post('workspace/emojis/upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 512 * 1024 },
    }),
  )
  async uploadCustomEmoji(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @UploadedFile()
    file:
      | {
          buffer: Buffer;
          originalname: string;
          mimetype: string;
          size: number;
        }
      | undefined,
  ) {
    const orgId = organizationId?.trim();
    if (!orgId) {
      throw new ForbiddenAppException(
        'X-Organization-Id is required to upload custom emoji',
      );
    }
    if (!file?.buffer?.length) {
      throw new BadRequestAppException('Image file is required');
    }
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestAppException('Custom emoji must be an image');
    }

    const isPlatformAdmin = user.role === UserRole.ADMIN;
    if (!isPlatformAdmin) {
      await this.proxy.sendAuth(
        AUTH_PATTERNS.LIST_ORG_MEMBERS,
        { organizationId: orgId, requestedByUserId: user.id },
        { skipTenant: true },
      );
    }

    const uploaded = await this.storage.upload({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      purpose: 'emoji',
      userName: user.email,
    });
    return {
      message: 'Custom emoji uploaded',
      data: {
        url: uploaded.url,
        key: uploaded.key,
        provider: uploaded.provider,
        mime: uploaded.mime,
        name: uploaded.name,
        size: uploaded.size,
      },
    };
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
  async previewLink(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LinkPreviewDto,
  ) {
    const data = await this.linkPreview.fetch(dto.url, user.id);
    return { message: 'Link preview ready', data };
  }

  @Get('admin/compliance/retention')
  async listRetention(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: OrgRequest,
  ) {
    this.assertWorkspaceManager(user, request);
    const data = await this.proxy.sendChat(
      CHAT_PATTERNS.LIST_RETENTION_POLICIES,
      { actorId: user.id },
    );
    return { message: 'Retention policies', data };
  }

  @Post('admin/compliance/retention')
  async upsertRetention(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: OrgRequest,
    @Body()
    body: {
      id?: string;
      name: string;
      scope?: 'workspace' | 'channel';
      conversationId?: string | null;
      retainDays: number;
      enabled?: boolean;
    },
  ) {
    this.assertWorkspaceManager(user, request);
    const data = await this.proxy.sendChat(CHAT_PATTERNS.UPSERT_RETENTION_POLICY, {
      actorId: user.id,
      ...body,
    });
    return { message: 'Retention policy saved', data };
  }

  @Post('admin/compliance/retention/:id/delete')
  async deleteRetention(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: OrgRequest,
    @Param('id') id: string,
  ) {
    this.assertWorkspaceManager(user, request);
    const data = await this.proxy.sendChat(CHAT_PATTERNS.DELETE_RETENTION_POLICY, {
      actorId: user.id,
      id,
    });
    return { message: 'Retention policy deleted', data };
  }

  @Get('admin/compliance/retention/purge-status')
  async retentionPurgeStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: OrgRequest,
  ) {
    this.assertWorkspaceManager(user, request);
    const data = await this.proxy.sendChat<RetentionPurgeStatusView>(
      CHAT_PATTERNS.GET_RETENTION_PURGE_STATUS,
      { actorId: user.id },
    );
    return { message: 'Retention purge status', data };
  }

  @Post('admin/compliance/retention/purge')
  async runRetentionPurge(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: OrgRequest,
  ) {
    this.assertWorkspaceManager(user, request);
    const organizationId = request.organization?.id;
    if (!organizationId) {
      throw new ForbiddenAppException('Workspace required');
    }
    const data = await this.proxy.sendChat(CHAT_PATTERNS.RUN_RETENTION_PURGE, {
      actorId: user.id,
      organizationId,
      trigger: 'manual',
    });
    return { message: 'Retention purge complete', data };
  }

  @Get('admin/compliance/holds')
  async listHolds(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: OrgRequest,
  ) {
    this.assertWorkspaceManager(user, request);
    const data = await this.proxy.sendChat(CHAT_PATTERNS.LIST_LEGAL_HOLDS, {
      actorId: user.id,
    });
    return { message: 'Legal holds', data };
  }

  @Post('admin/compliance/holds')
  async createHold(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: OrgRequest,
    @Body()
    body: {
      name: string;
      reason?: string;
      scope?: 'workspace' | 'channel' | 'user';
      conversationId?: string | null;
      userId?: string | null;
    },
  ) {
    this.assertWorkspaceManager(user, request);
    const data = await this.proxy.sendChat(CHAT_PATTERNS.CREATE_LEGAL_HOLD, {
      actorId: user.id,
      ...body,
    });
    return { message: 'Legal hold created', data };
  }

  @Post('admin/compliance/holds/:id/release')
  async releaseHold(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: OrgRequest,
    @Param('id') id: string,
  ) {
    this.assertWorkspaceManager(user, request);
    const data = await this.proxy.sendChat(CHAT_PATTERNS.RELEASE_LEGAL_HOLD, {
      actorId: user.id,
      id,
    });
    return { message: 'Legal hold released', data };
  }

  @Post('admin/compliance/ediscovery')
  async ediscovery(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: OrgRequest,
    @Body()
    body: {
      query?: string;
      conversationId?: string | null;
      from?: string | null;
      to?: string | null;
      limit?: number;
    },
  ) {
    this.assertWorkspaceManager(user, request);
    const data = await this.proxy.sendChat(CHAT_PATTERNS.EDISCOVERY_EXPORT, {
      actorId: user.id,
      ...body,
    });
    return { message: 'eDiscovery export ready', data };
  }

  @Get('admin/migrations')
  async listMigrations(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: OrgRequest,
  ) {
    this.assertWorkspaceManager(user, request);
    const data = await this.proxy.sendChat(CHAT_PATTERNS.LIST_MIGRATION_JOBS, {
      actorId: user.id,
    });
    return { message: 'Migration jobs', data };
  }

  @Post('admin/migrations/import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  async importMigration(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: OrgRequest,
    @Body() body: { source?: string; dryRun?: string },
    @UploadedFile()
    file:
      | {
          buffer: Buffer;
          originalname: string;
          mimetype: string;
          size: number;
        }
      | undefined,
  ) {
    this.assertWorkspaceManager(user, request);
    if (!file?.buffer?.length) {
      throw new BadRequestAppException('Upload a Slack/Teams JSON export file');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.buffer.toString('utf8'));
    } catch {
      throw new BadRequestAppException('Invalid JSON export file');
    }
    const source = body.source === 'teams' ? 'teams' : 'slack';
    const dryRun = body.dryRun === 'true' || body.dryRun === '1';
    const data = await this.proxy.sendChat(CHAT_PATTERNS.IMPORT_MIGRATION, {
      actorId: user.id,
      source,
      dryRun,
      data: parsed,
    });
    return { message: dryRun ? 'Dry run complete' : 'Import complete', data };
  }
}
