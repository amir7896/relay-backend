import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  AuthenticatedUser,
  CurrentUser,
  Public,
  Roles,
  UserRole,
} from '@app/common';
import type { PaginatedResult } from '@app/common';
import { CHAT_PATTERNS } from '@app/contracts';
import type {
  AuditEventView,
  ChatAnalyticsView,
  WorkspaceSettingsView,
} from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { PresenceService } from '../chat/presence.service';
import { LinkPreviewService } from '../chat/link-preview.service';
import { LinkPreviewDto, UpdateWorkspaceDto } from './dto/admin.dto';
import { ChatPageQueryDto } from '../chat/dto/chat.dto';

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
  async workspaceSettings() {
    const data = await this.proxy.sendChat<WorkspaceSettingsView>(
      CHAT_PATTERNS.GET_WORKSPACE,
      {},
    );
    return { message: 'Workspace settings', data };
  }

  @Patch('workspace/settings')
  @Roles(UserRole.ADMIN)
  async updateWorkspace(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    const data = await this.proxy.sendChat<WorkspaceSettingsView>(
      CHAT_PATTERNS.UPDATE_WORKSPACE,
      { actorId: user.id, ...dto },
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
