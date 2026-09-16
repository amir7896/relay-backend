import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import {
  AuthenticatedUser,
  BadRequestAppException,
  CurrentUser,
  MailService,
  ParseUuidPipe,
  Public,
} from '@app/common';
import {
  AUTH_PATTERNS,
  CHAT_PATTERNS,
  type ChannelCanvasView,
  type InviteView,
  type SharedChannelInfoView,
  type SharedChannelInvitePreviewView,
  type SharedChannelInviteView,
} from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { StorageService } from '../storage/storage.service';
import { ChatGateway } from './chat.gateway';
import { SkipOrg } from '../organizations/skip-org.decorator';

@Controller('chat')
export class SlackProductsController {
  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly chatGateway: ChatGateway,
    private readonly storage: StorageService,
    private readonly mail: MailService,
  ) {}
  private payload(user: AuthenticatedUser, id?: string, extra: Record<string, unknown> = {}) {
    return { actorId: user.id, ...(id ? { conversationId: id } : {}), ...extra };
  }

  @Get('conversations/:id/canvas') getCanvas(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string) { return this.wrap('Canvas retrieved', CHAT_PATTERNS.GET_CANVAS, this.payload(u, id)); }
  @Put('conversations/:id/canvas')
  async putCanvas(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() b: Record<string, unknown>,
  ) {
    const data = (await this.proxy.sendChat(
      CHAT_PATTERNS.PUT_CANVAS,
      this.payload(u, id, b),
    )) as ChannelCanvasView;
    this.chatGateway.broadcastCanvas(data);
    return { message: 'Canvas saved', data };
  }
  @Get('conversations/:id/lists') lists(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string) { return this.wrap('Lists retrieved', CHAT_PATTERNS.LIST_CHANNEL_LISTS, this.payload(u, id)); }
  @Post('conversations/:id/lists') createList(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string, @Body() b: Record<string, unknown>) { return this.wrap('List created', CHAT_PATTERNS.CREATE_CHANNEL_LIST, this.payload(u, id, b)); }
  @Get('conversations/:id/lists/:listId') getList(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string, @Param('listId', ParseUuidPipe) listId: string) { return this.wrap('List retrieved', CHAT_PATTERNS.GET_CHANNEL_LIST, this.payload(u, id, { listId })); }
  @Patch('conversations/:id/lists/:listId') updateList(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string, @Param('listId', ParseUuidPipe) listId: string, @Body() b: Record<string, unknown>) { return this.wrap('List updated', CHAT_PATTERNS.UPDATE_CHANNEL_LIST, this.payload(u, id, { listId, ...b })); }
  @Delete('conversations/:id/lists/:listId') deleteList(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string, @Param('listId', ParseUuidPipe) listId: string) { return this.wrap('List deleted', CHAT_PATTERNS.DELETE_CHANNEL_LIST, this.payload(u, id, { listId })); }
  @Post('conversations/:id/lists/:listId/items') createItem(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string, @Param('listId', ParseUuidPipe) listId: string, @Body() b: Record<string, unknown>) { return this.wrap('List item created', CHAT_PATTERNS.CREATE_CHANNEL_LIST_ITEM, this.payload(u, id, { listId, ...b })); }
  @Patch('conversations/:id/lists/:listId/items/:itemId') updateItem(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string, @Param('listId', ParseUuidPipe) listId: string, @Param('itemId', ParseUuidPipe) itemId: string, @Body() b: Record<string, unknown>) { return this.wrap('List item updated', CHAT_PATTERNS.UPDATE_CHANNEL_LIST_ITEM, this.payload(u, id, { listId, itemId, ...b })); }
  @Delete('conversations/:id/lists/:listId/items/:itemId') deleteItem(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string, @Param('listId', ParseUuidPipe) listId: string, @Param('itemId', ParseUuidPipe) itemId: string) { return this.wrap('List item deleted', CHAT_PATTERNS.DELETE_CHANNEL_LIST_ITEM, this.payload(u, id, { listId, itemId })); }
  @Get('conversations/:id/clips') clips(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string) { return this.wrap('Clips retrieved', CHAT_PATTERNS.LIST_CLIPS, this.payload(u, id)); }
  @Post('conversations/:id/clips') createClip(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string, @Body() b: Record<string, unknown>) { return this.wrap('Clip created', CHAT_PATTERNS.CREATE_CLIP, this.payload(u, id, b)); }
  @Delete('conversations/:id/clips/:clipId')
  async deleteClip(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('clipId', ParseUuidPipe) clipId: string,
  ) {
    const data = (await this.proxy.sendChat(
      CHAT_PATTERNS.DELETE_CLIP,
      this.payload(u, id, { clipId }),
    )) as { deleted: boolean; mediaUrl?: string };
    if (data.mediaUrl) {
      await this.storage.deleteByUrl(data.mediaUrl).catch(() => undefined);
    }
    return { message: 'Clip deleted', data };
  }
  @Get('conversations/:id/huddle') huddle(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string) { return this.wrap('Huddle retrieved', CHAT_PATTERNS.GET_HUDDLE, this.payload(u, id)); }
  @Post('conversations/:id/huddle/:action')
  mutateHuddle(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string, @Param('action') action: string) {
    const map: Record<string, string> = { start: CHAT_PATTERNS.START_HUDDLE, join: CHAT_PATTERNS.JOIN_HUDDLE, leave: CHAT_PATTERNS.LEAVE_HUDDLE, end: CHAT_PATTERNS.END_HUDDLE };
    if (!map[action]) throw new BadRequestAppException('action must be start, join, leave, or end');
    return this.wrap(`Huddle ${action}`, map[action], this.payload(u, id));
  }
  @Get('conversations/:id/workflows') workflows(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string) { return this.wrap('Workflows retrieved', CHAT_PATTERNS.LIST_WORKFLOWS, this.payload(u, id)); }
  @Post('conversations/:id/workflows') createWorkflow(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string, @Body() b: Record<string, unknown>) { return this.wrap('Workflow created', CHAT_PATTERNS.CREATE_WORKFLOW, this.payload(u, id, b)); }
  @Patch('conversations/:id/workflows/:workflowId') updateWorkflow(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string, @Param('workflowId', ParseUuidPipe) workflowId: string, @Body() b: Record<string, unknown>) { return this.wrap('Workflow updated', CHAT_PATTERNS.UPDATE_WORKFLOW, this.payload(u, id, { workflowId, ...b })); }
  @Delete('conversations/:id/workflows/:workflowId') deleteWorkflow(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string, @Param('workflowId', ParseUuidPipe) workflowId: string) { return this.wrap('Workflow deleted', CHAT_PATTERNS.DELETE_WORKFLOW, this.payload(u, id, { workflowId })); }
  @Post('conversations/:id/workflows/:workflowId/run')
  async runWorkflow(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('workflowId', ParseUuidPipe) workflowId: string,
  ) {
    const data = (await this.proxy.sendChat(CHAT_PATTERNS.RUN_WORKFLOW, this.payload(u, id, { workflowId }))) as {
      messages?: Array<Record<string, unknown> & { conversationId: string; recipientIds?: string[] }>;
    };
    for (const message of data.messages ?? []) {
      const { recipientIds, ...view } = message;
      this.chatGateway.broadcastMessage(view as any, recipientIds ?? []);
    }
    return { message: 'Workflow ran', data };
  }
  @Post('conversations/:id/connect/invite')
  async invite(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() b: Record<string, unknown>,
  ) {
    const email = String(b.email ?? '').trim().toLowerCase();
    if (!email) throw new BadRequestAppException('A valid email is required');

    const shared = (await this.proxy.sendChat(
      CHAT_PATTERNS.CREATE_SHARED_INVITE,
      this.payload(u, id, { email }),
    )) as SharedChannelInviteView;

    let workspaceInvite: InviteView | null = null;
    try {
      workspaceInvite = await this.proxy.sendAuth<InviteView>(
        AUTH_PATTERNS.CREATE_INVITE,
        {
          createdByUserId: u.id,
          organizationId: shared.organizationId,
          email,
          expiresInDays: 14,
          role: 'guest',
          skipEmail: true,
          pendingChannelId: id,
        },
      );
    } catch (error: unknown) {
      await this.proxy
        .sendChat(CHAT_PATTERNS.REVOKE_SHARED_INVITE, this.payload(u, id, { inviteId: shared.id }))
        .catch(() => undefined);
      const message =
        error instanceof Error ? error.message : 'Could not create Connect invite';
      throw new BadRequestAppException(message);
    }

    const rawToken = workspaceInvite.token;
    if (!rawToken) {
      throw new BadRequestAppException('Could not create Connect invite token');
    }

    const bound = (await this.proxy.sendChat(
      CHAT_PATTERNS.BIND_SHARED_INVITE_TOKEN,
      this.payload(u, id, { inviteId: shared.id, token: rawToken }),
    )) as SharedChannelInviteView;

    const inviteUrl = `${this.mail.publicAppUrl}/connect-invite/${rawToken}`;
    const data = {
      ...bound,
      token: rawToken,
      inviteUrl,
      workspaceInviteId: workspaceInvite.id,
    };

    return { message: 'Connect invite created', data };
  }

  @Get('conversations/:id/connect')
  connect(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string) {
    return this.wrap('Shared channel status retrieved', CHAT_PATTERNS.GET_SHARED_INFO, this.payload(u, id));
  }

  @Delete('conversations/:id/connect/invites/:inviteId')
  revokeInvite(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('inviteId', ParseUuidPipe) inviteId: string,
  ) {
    return this.wrap(
      'Connect invite revoked',
      CHAT_PATTERNS.REVOKE_SHARED_INVITE,
      this.payload(u, id, { inviteId }),
    );
  }

  @Public()
  @Get('connect/invites/:token')
  async previewConnectInvite(@Param('token') token: string) {
    const shared = (await this.proxy.sendChat(
      CHAT_PATTERNS.PREVIEW_SHARED_INVITE,
      { token },
      { skipTenant: true },
    )) as SharedChannelInvitePreviewView;

    let organizationName: string | null = shared.organizationName ?? null;
    try {
      const authPreview = await this.proxy.sendAuth<{
        organizationName?: string | null;
        valid?: boolean;
        pendingChannelId?: string | null;
      }>(AUTH_PATTERNS.GET_INVITE, { token });
      organizationName = authPreview.organizationName ?? organizationName;
      if (authPreview.valid === false && !shared.valid) {
        return {
          message: 'Connect invite preview',
          data: { ...shared, organizationName, valid: false },
        };
      }
    } catch {
      // Auth preview optional when token is Connect-only.
    }

    return {
      message: 'Connect invite preview',
      data: { ...shared, organizationName },
    };
  }

  @SkipOrg()
  @Post('connect/invites/:token/accept')
  async acceptConnectInvite(
    @CurrentUser() u: AuthenticatedUser,
    @Param('token') token: string,
  ) {
    // Accept as workspace guest invite (token is bound to auth invite).
    const joined = await this.proxy.sendAuth<{
      organizationId: string;
      pendingChannelId?: string | null;
      role?: string;
      alreadyMember?: boolean;
      organizations?: unknown[];
      activeOrganizationId?: string;
    }>(
      AUTH_PATTERNS.ACCEPT_INVITE,
      {
        userId: u.id,
        email: u.email,
        inviteToken: token,
      },
      { skipTenant: true },
    );

    if (joined.pendingChannelId) {
      try {
        await this.proxy.sendChat(
          CHAT_PATTERNS.ENSURE_CHANNEL_MEMBER,
          {
            userId: u.id,
            conversationId: joined.pendingChannelId,
            organizationId: joined.organizationId,
          },
          { skipTenant: true },
        );
      } catch {
        // Channel join best-effort.
      }
      await this.proxy
        .sendChat(
          CHAT_PATTERNS.MARK_SHARED_INVITE_ACCEPTED,
          {
            conversationId: joined.pendingChannelId,
            email: u.email,
            externalLabel: u.email,
          },
          { skipTenant: true },
        )
        .catch(() => undefined);
    }

    await this.proxy
      .sendChat(CHAT_PATTERNS.ACCEPT_SHARED_INVITE, { actorId: u.id, token }, { skipTenant: true })
      .catch(() => undefined);

    return {
      message: 'Joined shared channel',
      data: {
        organizationId: joined.organizationId,
        conversationId: joined.pendingChannelId ?? null,
        role: joined.role ?? 'guest',
        organizations: joined.organizations ?? [],
        activeOrganizationId:
          joined.activeOrganizationId ?? joined.organizationId,
      },
    };
  }

  @Get('apps/installed') installed(@CurrentUser() u: AuthenticatedUser) { return this.wrap('Installed apps retrieved', CHAT_PATTERNS.LIST_INSTALLED_APPS, this.payload(u)); }
  @Get('apps') apps(@CurrentUser() u: AuthenticatedUser) { return this.wrap('App catalog retrieved', CHAT_PATTERNS.LIST_APP_CATALOG, this.payload(u)); }
  @Post('apps/:appId/install') install(@CurrentUser() u: AuthenticatedUser, @Param('appId') appKey: string, @Body() b: Record<string, unknown>) { return this.wrap('App installed', CHAT_PATTERNS.INSTALL_APP, this.payload(u, undefined, { appKey, config: b.config ?? b })); }
  @Delete('apps/:appId/install') uninstall(@CurrentUser() u: AuthenticatedUser, @Param('appId') appKey: string) { return this.wrap('App uninstalled', CHAT_PATTERNS.UNINSTALL_APP, this.payload(u, undefined, { appKey })); }

  private async wrap(message: string, pattern: string, payload: Record<string, unknown>) {
    return { message, data: await this.proxy.sendChat(pattern, payload) };
  }
}
