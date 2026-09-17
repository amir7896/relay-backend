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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  AuthenticatedUser,
  BadRequestAppException,
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

@Controller()
export class AdminController {
  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly presence: PresenceService,
    private readonly linkPreview: LinkPreviewService,
    private readonly storage: StorageService,
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
}
