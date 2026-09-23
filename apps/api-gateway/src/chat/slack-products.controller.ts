import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
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
import { PushService } from './push.service';
import { SkipOrg } from '../organizations/skip-org.decorator';

@Controller('chat')
export class SlackProductsController {
  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly chatGateway: ChatGateway,
    private readonly storage: StorageService,
    private readonly mail: MailService,
    private readonly push: PushService,
  ) {}
  private payload(user: AuthenticatedUser, id?: string, extra: Record<string, unknown> = {}) {
    return { actorId: user.id, ...(id ? { conversationId: id } : {}), ...extra };
  }

  private async deliverAssignmentNotification(
    notification: {
      id: string;
      userId: string;
      actorId: string;
      title: string;
      body: string;
      conversationId: string | null;
      type?: string;
      listId?: string | null;
      listItemId?: string | null;
      meta?: Record<string, unknown>;
      readAt?: string | null;
      createdAt?: string;
      unread?: boolean;
      organizationId?: string;
    } | null | undefined,
  ) {
    if (!notification?.userId) return;
    this.chatGateway.emitUserNotification(notification.userId, notification);
    if (notification.conversationId) {
      void this.push.notifyAssignment({
        recipientId: notification.userId,
        senderId: notification.actorId,
        title: notification.title,
        body: notification.body,
        conversationId: notification.conversationId,
        notificationId: notification.id,
      });
    }
  }

  @Get('conversations/:id/canvas') getCanvas(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string) { return this.wrap('Canvas retrieved', CHAT_PATTERNS.GET_CANVAS, this.payload(u, id)); }
  @Get('conversations/:id/whiteboard') getWhiteboard(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string) { return this.wrap('Whiteboard retrieved', CHAT_PATTERNS.GET_WHITEBOARD, this.payload(u, id)); }
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
  @Get('conversations/:id/canvas/comments')
  listCanvasComments(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
  ) {
    return this.wrap(
      'Canvas comments retrieved',
      CHAT_PATTERNS.LIST_CANVAS_COMMENTS,
      this.payload(u, id),
    );
  }
  @Post('conversations/:id/canvas/comments')
  async createCanvasComment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() b: Record<string, unknown>,
  ) {
    const data = (await this.proxy.sendChat(
      CHAT_PATTERNS.CREATE_CANVAS_COMMENT,
      this.payload(u, id, b),
    )) as Record<string, unknown>;
    this.chatGateway.broadcastCanvasComment(id, {
      action: 'created',
      comment: data,
    });
    return { message: 'Canvas comment created', data };
  }
  @Post('conversations/:id/canvas/comments/:commentId/resolve')
  async resolveCanvasComment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('commentId', ParseUuidPipe) commentId: string,
  ) {
    const data = (await this.proxy.sendChat(
      CHAT_PATTERNS.RESOLVE_CANVAS_COMMENT,
      this.payload(u, id, { commentId }),
    )) as Record<string, unknown>;
    this.chatGateway.broadcastCanvasComment(id, {
      action: 'updated',
      comment: data,
    });
    return { message: 'Canvas comment updated', data };
  }
  @Delete('conversations/:id/canvas/comments/:commentId')
  async deleteCanvasComment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('commentId', ParseUuidPipe) commentId: string,
  ) {
    await this.proxy.sendChat(
      CHAT_PATTERNS.DELETE_CANVAS_COMMENT,
      this.payload(u, id, { commentId }),
    );
    this.chatGateway.broadcastCanvasComment(id, {
      action: 'deleted',
      commentId,
    });
    return { message: 'Canvas comment deleted', data: { id: commentId } };
  }
  @Get('conversations/:id/lists') lists(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string) { return this.wrap('Lists retrieved', CHAT_PATTERNS.LIST_CHANNEL_LISTS, this.payload(u, id)); }
  @Post('conversations/:id/lists') createList(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string, @Body() b: Record<string, unknown>) { return this.wrap('List created', CHAT_PATTERNS.CREATE_CHANNEL_LIST, this.payload(u, id, b)); }
  @Get('conversations/:id/lists/:listId') getList(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string, @Param('listId', ParseUuidPipe) listId: string) { return this.wrap('List retrieved', CHAT_PATTERNS.GET_CHANNEL_LIST, this.payload(u, id, { listId })); }
  @Patch('conversations/:id/lists/:listId') updateList(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string, @Param('listId', ParseUuidPipe) listId: string, @Body() b: Record<string, unknown>) { return this.wrap('List updated', CHAT_PATTERNS.UPDATE_CHANNEL_LIST, this.payload(u, id, { listId, ...b })); }
  @Delete('conversations/:id/lists/:listId') deleteList(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string, @Param('listId', ParseUuidPipe) listId: string) { return this.wrap('List deleted', CHAT_PATTERNS.DELETE_CHANNEL_LIST, this.payload(u, id, { listId })); }
  @Post('conversations/:id/lists/:listId/items')
  async createItem(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('listId', ParseUuidPipe) listId: string,
    @Body() b: Record<string, unknown>,
  ) {
    const result = (await this.proxy.sendChat(
      CHAT_PATTERNS.CREATE_CHANNEL_LIST_ITEM,
      this.payload(u, id, { listId, ...b }),
    )) as {
      item: Record<string, unknown>;
      notification?: Record<string, unknown> | null;
      channelMessage?: (Record<string, unknown> & {
        conversationId: string;
        recipientIds?: string[];
      }) | null;
    };
    await this.deliverAssignmentNotification(result.notification as any);
    if (result.channelMessage) {
      const { recipientIds, ...view } = result.channelMessage;
      this.chatGateway.broadcastMessage(view as any, recipientIds ?? []);
    }
    return { message: 'List item created', data: result.item };
  }

  @Patch('conversations/:id/lists/:listId/items/:itemId')
  async updateItem(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('listId', ParseUuidPipe) listId: string,
    @Param('itemId', ParseUuidPipe) itemId: string,
    @Body() b: Record<string, unknown>,
  ) {
    const result = (await this.proxy.sendChat(
      CHAT_PATTERNS.UPDATE_CHANNEL_LIST_ITEM,
      this.payload(u, id, { listId, itemId, ...b }),
    )) as {
      item: Record<string, unknown>;
      notification?: Record<string, unknown> | null;
      channelMessage?: (Record<string, unknown> & {
        conversationId: string;
        recipientIds?: string[];
      }) | null;
    };
    await this.deliverAssignmentNotification(result.notification as any);
    if (result.channelMessage) {
      const { recipientIds, ...view } = result.channelMessage;
      this.chatGateway.broadcastMessage(view as any, recipientIds ?? []);
    }
    return { message: 'List item updated', data: result.item };
  }

  @Delete('conversations/:id/lists/:listId/items/:itemId') deleteItem(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string, @Param('listId', ParseUuidPipe) listId: string, @Param('itemId', ParseUuidPipe) itemId: string) { return this.wrap('List item deleted', CHAT_PATTERNS.DELETE_CHANNEL_LIST_ITEM, this.payload(u, id, { listId, itemId })); }

  @Get('conversations/:id/lists/:listId/items/:itemId/comments')
  listItemComments(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('listId', ParseUuidPipe) listId: string,
    @Param('itemId', ParseUuidPipe) itemId: string,
  ) {
    return this.wrap(
      'List item comments retrieved',
      CHAT_PATTERNS.LIST_CHANNEL_LIST_ITEM_COMMENTS,
      this.payload(u, id, { listId, itemId }),
    );
  }

  @Post('conversations/:id/lists/:listId/items/:itemId/comments')
  createItemComment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('listId', ParseUuidPipe) listId: string,
    @Param('itemId', ParseUuidPipe) itemId: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.wrap(
      'List item comment created',
      CHAT_PATTERNS.CREATE_CHANNEL_LIST_ITEM_COMMENT,
      this.payload(u, id, { listId, itemId, ...b }),
    );
  }

  @Delete('conversations/:id/lists/:listId/items/:itemId/comments/:commentId')
  deleteItemComment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('listId', ParseUuidPipe) listId: string,
    @Param('itemId', ParseUuidPipe) itemId: string,
    @Param('commentId', ParseUuidPipe) commentId: string,
  ) {
    return this.wrap(
      'List item comment deleted',
      CHAT_PATTERNS.DELETE_CHANNEL_LIST_ITEM_COMMENT,
      this.payload(u, id, { listId, itemId, commentId }),
    );
  }

  @Get('notifications')
  listNotifications(
    @CurrentUser() u: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.wrap('Notifications retrieved', CHAT_PATTERNS.LIST_USER_NOTIFICATIONS, {
      actorId: u.id,
      page: Number(page) || 1,
      limit: Number(limit) || 40,
      unreadOnly: unreadOnly === '1' || unreadOnly === 'true',
    });
  }

  @Get('notifications/unread-count')
  unreadNotificationCount(@CurrentUser() u: AuthenticatedUser) {
    return this.wrap(
      'Unread notification count',
      CHAT_PATTERNS.COUNT_UNREAD_USER_NOTIFICATIONS,
      { actorId: u.id },
    );
  }

  @Post('notifications/read-all')
  markAllNotificationsRead(@CurrentUser() u: AuthenticatedUser) {
    return this.wrap(
      'Notifications marked read',
      CHAT_PATTERNS.MARK_ALL_USER_NOTIFICATIONS_READ,
      { actorId: u.id },
    );
  }

  @Post('notifications/:notificationId/read')
  markNotificationRead(
    @CurrentUser() u: AuthenticatedUser,
    @Param('notificationId', ParseUuidPipe) notificationId: string,
  ) {
    return this.wrap('Notification marked read', CHAT_PATTERNS.MARK_USER_NOTIFICATION_READ, {
      actorId: u.id,
      notificationId,
    });
  }
  @Get('conversations/:id/clips') clips(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string) { return this.wrap('Clips retrieved', CHAT_PATTERNS.LIST_CLIPS, this.payload(u, id)); }
  @Post('conversations/:id/clips')
  async createClip(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() b: Record<string, unknown>,
  ) {
    const result = (await this.proxy.sendChat(
      CHAT_PATTERNS.CREATE_CLIP,
      this.payload(u, id, b),
    )) as {
      clip?: Record<string, unknown>;
      channelMessage?: (Record<string, unknown> & {
        conversationId: string;
        recipientIds?: string[];
      }) | null;
    } & Record<string, unknown>;

    const clip = result.clip ?? result;
    if (result.channelMessage) {
      const { recipientIds, ...view } = result.channelMessage;
      this.chatGateway.broadcastMessage(view as any, recipientIds ?? []);
    }
    return { message: 'Clip created', data: clip };
  }
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
    const mode = b.mode === 'workspace' ? 'workspace' : 'guest';

    if (mode === 'workspace') {
      const shared = (await this.proxy.sendChat(
        CHAT_PATTERNS.CREATE_SHARED_INVITE,
        this.payload(u, id, { email, mode: 'workspace' }),
      )) as SharedChannelInviteView;
      const rawToken = shared.token;
      if (!rawToken) {
        throw new BadRequestAppException('Could not create Connect invite token');
      }
      const inviteUrl = `${this.mail.publicAppUrl}/connect-invite/${rawToken}`;
      const emailed = await this.mail.send({
        to: email,
        subject: 'You’re invited to a shared Relay channel',
        text: [
          `You’ve been invited to connect on Relay.`,
          '',
          `Open this link to join:`,
          inviteUrl,
          '',
          `If you didn’t expect this, you can ignore the email.`,
        ].join('\n'),
        html: `<p>You’ve been invited to connect on <strong>Relay</strong>.</p><p><a href="${inviteUrl}">Accept invite</a></p><p style="color:#666;font-size:12px">${inviteUrl}</p>`,
      });
      return {
        message: emailed.delivered
          ? 'Workspace Connect invite created and emailed'
          : 'Workspace Connect invite created',
        data: {
          ...shared,
          token: rawToken,
          inviteUrl,
          inviteKind: 'workspace_share' as const,
          emailDelivered: emailed.delivered,
        },
      };
    }

    const shared = (await this.proxy.sendChat(
      CHAT_PATTERNS.CREATE_SHARED_INVITE,
      this.payload(u, id, { email, mode: 'guest' }),
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
      inviteKind: 'guest_email' as const,
    };

    const emailed = await this.mail.send({
      to: email,
      subject: 'You’re invited to join a Relay channel',
      text: [
        `You’ve been invited as a guest on Relay.`,
        '',
        `Open this link to accept:`,
        inviteUrl,
        '',
        `If you didn’t expect this, you can ignore the email.`,
      ].join('\n'),
      html: `<p>You’re invited as a guest on <strong>Relay</strong>.</p><p><a href="${inviteUrl}">Accept invite</a></p><p style="color:#666;font-size:12px">${inviteUrl}</p>`,
    });

    return {
      message: emailed.delivered
        ? 'Connect invite created and emailed'
        : 'Connect invite created',
      data: { ...data, emailDelivered: emailed.delivered },
    };
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

  @Delete('conversations/:id/connect/links/:linkId')
  disconnectLink(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('linkId', ParseUuidPipe) linkId: string,
  ) {
    return this.wrap(
      'Shared channel disconnected',
      CHAT_PATTERNS.DISCONNECT_SHARED_CHANNEL,
      this.payload(u, id, { linkId }),
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
      // Auth preview optional when token is Connect-only (workspace share).
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
    @Body() b: Record<string, unknown> = {},
  ) {
    const preview = (await this.proxy.sendChat(
      CHAT_PATTERNS.PREVIEW_SHARED_INVITE,
      { token },
      { skipTenant: true },
    )) as SharedChannelInvitePreviewView;

    if (preview.inviteKind === 'workspace_share') {
      const partnerOrganizationId = String(
        b.partnerOrganizationId ?? '',
      ).trim();
      if (!partnerOrganizationId) {
        throw new BadRequestAppException(
          'partnerOrganizationId is required — accept from your workspace',
        );
      }
      if (
        preview.organizationId &&
        partnerOrganizationId === String(preview.organizationId)
      ) {
        throw new BadRequestAppException(
          'Accept from your other workspace — not the host organization',
        );
      }

      const result = (await this.proxy.sendChat(
        CHAT_PATTERNS.ACCEPT_WORKSPACE_SHARE,
        {
          actorId: u.id,
          token,
          partnerOrganizationId,
          partnerOrganizationName: b.partnerOrganizationName
            ? String(b.partnerOrganizationName)
            : null,
          hostOrganizationName:
            preview.organizationName ??
            (b.hostOrganizationName ? String(b.hostOrganizationName) : null),
        },
        { skipTenant: true },
      )) as {
        organizationId: string;
        conversationId: string;
        hostConversationId: string;
        alreadyConnected?: boolean;
      };

      return {
        message: result.alreadyConnected
          ? 'Already connected to shared channel'
          : 'Workspace connected to shared channel',
        data: {
          organizationId: result.organizationId,
          conversationId: result.conversationId,
          hostConversationId: result.hostConversationId,
          role: 'member',
          inviteKind: 'workspace_share' as const,
          organizations: [],
          activeOrganizationId: result.organizationId,
        },
      };
    }

    // Guest-into-host path (legacy Connect).
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
        inviteKind: 'guest_email' as const,
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
  @Post('apps/:appId/run')
  async runBot(
    @CurrentUser() u: AuthenticatedUser,
    @Param('appId') appKey: string,
    @Body() b: Record<string, unknown>,
  ) {
    const result = (await this.proxy.sendChat(
      CHAT_PATTERNS.RUN_STANDUP_NOW,
      this.payload(u, undefined, { appKey, conversationId: b.conversationId }),
    )) as { message?: Record<string, unknown> & { conversationId: string; recipientIds?: string[] } };
    if (result?.message) {
      const { recipientIds, ...view } = result.message;
      this.chatGateway.broadcastMessage(view as any, recipientIds ?? []);
    }
    return { message: 'Standup posted', data: result };
  }
  @Get('conversations/:id/standup')
  standupBoard(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Query('appKey') appKey?: string,
  ) {
    return this.wrap(
      'Standup board retrieved',
      CHAT_PATTERNS.GET_STANDUP_BOARD,
      this.payload(u, id, appKey ? { appKey } : {}),
    );
  }

  @Post('conversations/:id/standup/summary')
  async standupSummary(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() b: Record<string, unknown>,
  ) {
    const result = (await this.proxy.sendChat(
      CHAT_PATTERNS.SUMMARIZE_STANDUP,
      this.payload(u, id, { appKey: b.appKey }),
    )) as { message?: Record<string, unknown> & { conversationId: string; recipientIds?: string[] } };
    if (result?.message) {
      const { recipientIds, ...view } = result.message;
      this.chatGateway.broadcastMessage(view as any, recipientIds ?? []);
    }
    return { message: 'Standup summary posted', data: result };
  }

  private async wrap(message: string, pattern: string, payload: Record<string, unknown>) {
    return { message, data: await this.proxy.sendChat(pattern, payload) };
  }
}
