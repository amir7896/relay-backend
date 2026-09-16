import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  AuthenticatedUser,
  BadRequestAppException,
  CHAT_SUCCESS_MESSAGES,
  CurrentUser,
  ForbiddenAppException,
  MailService,
  NotFoundAppException,
  ParseUuidPipe,
  PresenceStatus,
  Public,
  channelAddedTemplate,
  channelInviteTemplate,
  isUuidToken,
  parseMessageSearchQuery,
} from '@app/common';
import type { PaginatedResult } from '@app/common';
import { AUTH_PATTERNS, CHAT_PATTERNS, USER_PATTERNS } from '@app/contracts';
import type {
  BlockView,
  ChannelInvitePreviewView,
  ChannelInviteView,
  ConversationView,
  DeleteMessageResult,
  IncomingWebhookView,
  OutgoingWebhookView,
  InviteView,
  InvokeSlashCommandResult,
  MessageView,
  OrganizationView,
  PresenceView,
  SeenResultView,
  SendMessageResult,
  SlashCommandView,
  UserGroupView,
  UserProfileView,
} from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { StorageService } from '../storage/storage.service';
import { ChatGateway } from './chat.gateway';
import { CallSessionService } from './call-session.service';
import { ConversationCacheService } from './conversation-cache.service';
import { PushService } from './push.service';
import { NotificationPrefsService } from './notification-prefs.service';
import {
  AddChannelBookmarkDto,
  AddMembersDto,
  BlockUserDto,
  ChatPageQueryDto,
  CreateChannelInviteDto,
  EmailChannelInviteDto,
  CreateGroupChatDto,
  CreateIncomingWebhookDto,
  CreateOutgoingWebhookDto,
  CreatePollDto,
  CreatePrivateChatDto,
  CreateReminderDto,
  CreateSidebarSectionDto,
  CreateSlashCommandDto,
  CreateUserGroupDto,
  DeleteMessageDto,
  EditMessageDto,
  ForwardMessageDto,
  InvokeSlashCommandDto,
  ListMediaQueryDto,
  MarkSeenDto,
  MarkUnreadDto,
  MuteConversationDto,
  PinConversationDto,
  PinMessageDto,
  ReactMessageDto,
  SaveBookmarkDto,
  ScheduleMessageDto,
  SearchMessagesQueryDto,
  SendMessageDto,
  SetDisappearingDto,
  SetMemberRoleDto,
  TypingDto,
  UpdateGroupDto,
  UpdateSidebarSectionDto,
  UpdateUserGroupDto,
  UpsertDraftDto,
  UpdateNotificationPrefsDto,
  UpdateChannelNotificationPrefsDto,
  VotePollDto,
} from './dto/chat.dto';
import { PresenceService } from './presence.service';
import { AiService } from './ai.service';
import {
  AddMembersDocs,
  ChatDocs,
  CreateGroupChatDocs,
  CreatePrivateChatDocs,
  DeleteGroupDocs,
  GetConversationDocs,
  GetPresenceDocs,
  LeaveConversationDocs,
  ListConversationsDocs,
  ListMessagesDocs,
  MarkSeenDocs,
  MarkUnreadDocs,
  RemoveMemberDocs,
  SendMessageDocs,
  TypingDocs,
  UpdateGroupDocs,
} from './swagger/chat.swagger';

const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
const ALLOWED_AUDIO_MIMES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  // Some browsers label audio-only MediaRecorder output as video/webm
  'video/webm',
]);
const ALLOWED_FILE_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/rtf',
  'text/rtf',
  'text/plain',
  'text/csv',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
]);
const ALLOWED_UPLOAD_MIMES = new Set([
  ...ALLOWED_IMAGE_MIMES,
  ...ALLOWED_AUDIO_MIMES,
  ...ALLOWED_FILE_MIMES,
]);
/** Images/voice stay small; documents may be larger (Cloudinary free tier ~10MB raw). */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const FILE_EXT_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.rtf': 'application/rtf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
};

function normalizeUploadMime(
  mimeType: string,
  originalName: string,
): string | null {
  if (mimeType === 'video/webm') {
    // Voice notes often arrive as video/webm; keep those as audio.
    // Explicit video clip uploads use a clip-video-* filename.
    if (/^clip-video/i.test(originalName) || /\/clip-video/i.test(originalName)) {
      return 'video/webm';
    }
    return 'audio/webm';
  }
  if (ALLOWED_UPLOAD_MIMES.has(mimeType)) {
    return mimeType;
  }
  // Some browsers send empty or generic mime for documents
  if (!mimeType || mimeType === 'application/octet-stream') {
    const ext = originalName.includes('.')
      ? `.${originalName.split('.').pop()!.toLowerCase()}`
      : '';
    const guessed = FILE_EXT_MIME[ext];
    if (guessed && ALLOWED_FILE_MIMES.has(guessed)) {
      return guessed;
    }
  }
  return null;
}

function resolveAttachmentContentType(
  mime: string | null | undefined,
  filename: string,
): string {
  const cleaned = (mime ?? '').trim();
  if (cleaned && cleaned !== 'application/octet-stream') {
    return cleaned;
  }
  const ext = filename.includes('.')
    ? `.${filename.split('.').pop()!.toLowerCase()}`
    : '';
  return FILE_EXT_MIME[ext] ?? 'application/octet-stream';
}

type UploadedImage = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

@ChatDocs()
@Controller('chat')
export class ChatController {
  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly presence: PresenceService,
    private readonly chatGateway: ChatGateway,
    private readonly conversationCache: ConversationCacheService,
    private readonly ai: AiService,
    private readonly storage: StorageService,
    private readonly push: PushService,
    private readonly notificationPrefs: NotificationPrefsService,
    private readonly calls: CallSessionService,
    private readonly mail: MailService,
  ) {}

  private assertFullMember(
    request: Request & { organization?: OrganizationView },
  ) {
    if (request.organization?.role === 'guest') {
      throw new ForbiddenAppException(
        'Guests can only access channels they are invited to',
      );
    }
  }

  private assertWorkspaceManager(
    request: Request & { organization?: OrganizationView },
  ) {
    const role = request.organization?.role;
    if (role !== 'owner' && role !== 'admin') {
      throw new ForbiddenAppException(
        'Only workspace owners and admins can manage this setting',
      );
    }
  }

  /** Resolve from:name|email tokens to userIds via the directory. */
  private async resolveSearchSenderIds(rawQuery: string): Promise<string[]> {
    const parsed = parseMessageSearchQuery(rawQuery);
    if (parsed.fromTokens.length === 0) {
      return [];
    }
    const ids = new Set<string>();
    for (const token of parsed.fromTokens) {
      if (isUuidToken(token)) {
        ids.add(token);
        continue;
      }
      try {
        const page = await this.proxy.sendUser<
          PaginatedResult<UserProfileView>
        >(USER_PATTERNS.FIND_ALL, {
          page: 1,
          limit: 40,
          search: token,
          sortBy: 'firstName',
          order: 'ASC',
        });
        for (const profile of page.items) {
          const hay =
            `${profile.firstName} ${profile.lastName} ${profile.email}`.toLowerCase();
          if (
            hay.includes(token) ||
            profile.email.toLowerCase().startsWith(token) ||
            profile.firstName.toLowerCase().startsWith(token) ||
            profile.lastName.toLowerCase().startsWith(token)
          ) {
            ids.add(profile.userId);
          }
        }
      } catch {
        // Directory lookup is best-effort; chat still accepts UUID from: tokens.
      }
    }
    return [...ids];
  }

  @Post('private')
  @HttpCode(HttpStatus.CREATED)
  @CreatePrivateChatDocs()
  async createPrivate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePrivateChatDto,
    @Req() request: Request & { organization?: OrganizationView },
  ) {
    this.assertFullMember(request);
    if (dto.userId === user.id) {
      throw new BadRequestAppException(
        'You cannot start a private chat with yourself',
      );
    }
    await this.assertUserExists(dto.userId);
    const data = await this.proxy.sendChat<ConversationView>(
      CHAT_PATTERNS.CREATE_PRIVATE,
      { actorId: user.id, otherUserId: dto.userId },
    );
    await this.presence.attachToConversations([data]);
    return { message: CHAT_SUCCESS_MESSAGES.PRIVATE_READY, data };
  }

  @Post('groups')
  @HttpCode(HttpStatus.CREATED)
  @CreateGroupChatDocs()
  async createGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGroupChatDto,
    @Req() request: Request & { organization?: OrganizationView },
  ) {
    this.assertFullMember(request);
    await this.assertUsersExist(dto.memberIds.filter((id) => id !== user.id));
    const data = await this.proxy.sendChat<ConversationView>(
      CHAT_PATTERNS.CREATE_GROUP,
      {
        actorId: user.id,
        name: dto.name,
        memberIds: dto.memberIds,
        visibility: dto.visibility,
        announceOnly: dto.announceOnly,
      },
    );
    await this.presence.attachToConversations([data]);
    const memberIds = data.members.map((member) => member.userId);
    await this.conversationCache.setMemberIds(data.id, memberIds);
    this.chatGateway.broadcastConversationUpdated(data, memberIds);
    void this.evaluateChannelWorkflows(user.id, data.id, 'channel_created');
    return { message: CHAT_SUCCESS_MESSAGES.GROUP_CREATED, data };
  }

  @Get('conversations')
  @ListConversationsDocs()
  async listConversations(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ChatPageQueryDto,
  ) {
    const data = await this.proxy.sendChat<PaginatedResult<ConversationView>>(
      CHAT_PATTERNS.LIST_CONVERSATIONS,
      {
        actorId: user.id,
        page: query.page,
        limit: query.limit,
      },
    );
    await this.presence.attachToConversations(data.items);
    await this.applyLastSeenPrivacy(data.items);
    return { message: CHAT_SUCCESS_MESSAGES.CONVERSATIONS_FETCHED, data };
  }

  @Get('search')
  async searchGlobal(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SearchMessagesQueryDto,
  ) {
    const senderIds = await this.resolveSearchSenderIds(query.q);
    const data = await this.proxy.sendChat(CHAT_PATTERNS.SEARCH_GLOBAL, {
      actorId: user.id,
      query: query.q,
      page: query.page,
      limit: query.limit,
      senderIds,
    });
    return { message: CHAT_SUCCESS_MESSAGES.GLOBAL_SEARCHED, data };
  }

  @Get('presence/:userId')
  @GetPresenceDocs()
  async getPresence(@Param('userId', ParseUuidPipe) userId: string) {
    const data = await this.presence.getPresence(userId);
    await this.stripLastSeenIfHidden(data);
    return { message: CHAT_SUCCESS_MESSAGES.PRESENCE_FETCHED, data };
  }

  @Patch('presence')
  async setMyPresence(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { status?: string; customStatus?: string | null },
  ) {
    const allowed = new Set([
      PresenceStatus.ONLINE,
      PresenceStatus.AWAY,
      PresenceStatus.BUSY,
      PresenceStatus.DND,
    ]);
    const status = (body.status as PresenceStatus) || PresenceStatus.ONLINE;
    if (!allowed.has(status)) {
      throw new BadRequestException('Invalid presence status');
    }
    const data = await this.presence.setStatus(
      user.id,
      status,
      body.customStatus,
    );
    this.chatGateway.emitPresenceUpdate(data);
    return { message: 'Presence updated', data };
  }

  @Get('conversations/:id')
  @GetConversationDocs()
  async getConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
  ) {
    const data = await this.proxy.sendChat<ConversationView>(
      CHAT_PATTERNS.GET_CONVERSATION,
      { actorId: user.id, conversationId: id },
    );
    await this.presence.attachToConversations([data]);
    await this.applyLastSeenPrivacy([data]);
    return { message: CHAT_SUCCESS_MESSAGES.CONVERSATION_FETCHED, data };
  }

  @Get('conversations/:id/messages/search')
  async searchMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: SearchMessagesQueryDto,
  ) {
    const senderIds = await this.resolveSearchSenderIds(query.q);
    const data = await this.proxy.sendChat(CHAT_PATTERNS.SEARCH_MESSAGES, {
      actorId: user.id,
      conversationId: id,
      query: query.q,
      page: query.page,
      limit: query.limit,
      senderIds,
    });
    return { message: CHAT_SUCCESS_MESSAGES.MESSAGES_SEARCHED, data };
  }

  @Get('conversations/:id/messages/thread/:threadRootId')
  async listThreadReplies(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('threadRootId', ParseUuidPipe) threadRootId: string,
    @Query() query: ChatPageQueryDto,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.LIST_THREAD_REPLIES, {
      actorId: user.id,
      conversationId: id,
      threadRootId,
      page: query.page,
      limit: query.limit,
    });
    return { message: CHAT_SUCCESS_MESSAGES.MESSAGES_FETCHED, data };
  }

  @Get('conversations/:id/messages/:messageId')
  async getMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('messageId', ParseUuidPipe) messageId: string,
  ) {
    const data = await this.proxy.sendChat<MessageView>(
      CHAT_PATTERNS.GET_MESSAGE,
      {
        actorId: user.id,
        conversationId: id,
        messageId,
      },
    );
    return { message: CHAT_SUCCESS_MESSAGES.MESSAGES_FETCHED, data };
  }

  @Get('channels/public')
  async listPublicChannels(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ChatPageQueryDto,
    @Req() request: Request & { organization?: OrganizationView },
  ) {
    this.assertFullMember(request);
    const data = await this.proxy.sendChat(CHAT_PATTERNS.LIST_PUBLIC_CHANNELS, {
      actorId: user.id,
      page: query.page,
      limit: query.limit,
    });
    return { message: CHAT_SUCCESS_MESSAGES.CONVERSATIONS_FETCHED, data };
  }

  @Post('conversations/:id/join')
  @HttpCode(HttpStatus.OK)
  async joinChannel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Req() request: Request & { organization?: OrganizationView },
  ) {
    this.assertFullMember(request);
    const data = await this.proxy.sendChat<ConversationView>(
      CHAT_PATTERNS.JOIN_CHANNEL,
      { actorId: user.id, conversationId: id },
    );
    await this.presence.attachToConversations([data]);
    const memberIds = data.members.map((member) => member.userId);
    await this.conversationCache.setMemberIds(data.id, memberIds);
    this.chatGateway.broadcastConversationUpdated(data, memberIds);
    return { message: CHAT_SUCCESS_MESSAGES.MEMBERS_ADDED, data };
  }

  @Get('conversations/:id/members')
  async listConversationMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: ChatPageQueryDto,
  ) {
    const data = await this.proxy.sendChat(
      CHAT_PATTERNS.LIST_CONVERSATION_MEMBERS,
      {
        actorId: user.id,
        conversationId: id,
        page: query.page,
        limit: query.limit,
      },
    );
    return { message: 'Channel members retrieved successfully', data };
  }

  @Post('conversations/:id/invites')
  @HttpCode(HttpStatus.CREATED)
  async createChannelInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: CreateChannelInviteDto,
  ) {
    const data = await this.proxy.sendChat<ChannelInviteView>(
      CHAT_PATTERNS.CREATE_CHANNEL_INVITE,
      {
        actorId: user.id,
        conversationId: id,
        expiresInHours: dto.expiresInHours,
        maxUses: dto.maxUses,
      },
    );
    return { message: 'Channel invite created successfully', data };
  }

  @Post('conversations/:id/invites/email')
  @HttpCode(HttpStatus.CREATED)
  async emailChannelInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: EmailChannelInviteDto,
    @Req() request: Request & { organization?: OrganizationView },
  ) {
    const email = dto.email.toLowerCase().trim();
    const conversation = await this.proxy.sendChat<ConversationView>(
      CHAT_PATTERNS.GET_CONVERSATION,
      { actorId: user.id, conversationId: id },
    );
    const channelName = conversation.name || 'channel';
    const orgName = request.organization?.name || 'the workspace';

    const directory = await this.proxy.sendUser<{
      items: UserProfileView[];
    }>(USER_PATTERNS.FIND_ALL, { search: email, page: 1, limit: 20 });
    const existing = (directory.items ?? []).find(
      (person) => person.email.toLowerCase() === email,
    );

    if (existing) {
      const alreadyInChannel = conversation.members.some(
        (member) => member.userId === existing.userId,
      );
      if (alreadyInChannel) {
        throw new BadRequestAppException(
          'That person is already a member of this channel',
        );
      }
      const updated = await this.proxy.sendChat<ConversationView>(
        CHAT_PATTERNS.ADD_MEMBERS,
        {
          actorId: user.id,
          conversationId: id,
          memberIds: [existing.userId],
        },
      );
      await this.presence.attachToConversations([updated]);
      const memberIds = updated.members.map((member) => member.userId);
      await this.conversationCache.setMemberIds(updated.id, memberIds);
      this.chatGateway.broadcastConversationUpdated(updated, memberIds);

      const channelUrl = `${this.mail.publicAppUrl}/chat/${id}`;
      const content = channelAddedTemplate({
        appUrl: this.mail.publicAppUrl,
        channelUrl,
        channelName,
        organizationName: orgName,
      });
      const mailResult = await this.mail.send({
        to: email,
        ...content,
      });

      return {
        message: mailResult.delivered
          ? 'Teammate added to the channel and notified by email'
          : 'Teammate added to the channel (email not delivered — SMTP may be unset)',
        data: {
          mode: 'added' as const,
          conversationId: id,
          userId: existing.userId,
          email,
          emailSent: mailResult.delivered,
        },
      };
    }

    let workspaceInvite: InviteView | null = null;
    try {
      if (!request.organization?.id) {
        throw new BadRequestAppException('Active workspace is required');
      }
      workspaceInvite = await this.proxy.sendAuth<InviteView>(
        AUTH_PATTERNS.CREATE_INVITE,
        {
          createdByUserId: user.id,
          organizationId: request.organization.id,
          email,
          expiresInDays: 7,
          role: 'member',
          skipEmail: true,
          pendingChannelId: id,
        },
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'object' &&
              error &&
              'message' in error &&
              typeof (error as { message: unknown }).message === 'string'
            ? (error as { message: string }).message
            : String(error ?? '');
      if (/already in this workspace/i.test(message)) {
        throw new BadRequestAppException(
          'That person is already in this workspace. Use Add people above to add them to this channel.',
        );
      }
      workspaceInvite = null;
    }

    if (!workspaceInvite?.inviteUrl && !workspaceInvite?.token) {
      throw new BadRequestAppException(
        'Could not create a workspace invite for that email',
      );
    }

    const inviteUrl =
      workspaceInvite.inviteUrl ||
      `${this.mail.publicAppUrl}/invite/${workspaceInvite.token}`;

    const content = channelInviteTemplate({
      appUrl: this.mail.publicAppUrl,
      channelName,
      organizationName: orgName,
      channelUrl: `${this.mail.publicAppUrl}/chat/${id}`,
      workspaceUrl: inviteUrl,
      autoJoinChannel: true,
    });
    const mailResult = await this.mail.send({
      to: email,
      ...content,
    });

    return {
      message: mailResult.delivered
        ? 'Channel invite email sent'
        : 'Invite created (email not delivered — copy the link below; configure SMTP to send mail)',
      data: {
        mode: 'invited' as const,
        email,
        emailSent: mailResult.delivered,
        workspaceInviteUrl: inviteUrl,
        inviteUrl,
        pendingChannelId: id,
        debugInviteUrl:
          mailResult.previewUrl ??
          (mailResult.delivered ? undefined : inviteUrl),
      },
    };
  }

  @Get('conversations/:id/invites')
  async listChannelInvites(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: ChatPageQueryDto,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.LIST_CHANNEL_INVITES, {
      actorId: user.id,
      conversationId: id,
      page: query.page,
      limit: query.limit,
    });
    return { message: 'Channel invites retrieved successfully', data };
  }

  @Delete('conversations/:id/invites/:inviteId')
  @HttpCode(HttpStatus.OK)
  async revokeChannelInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('inviteId', ParseUuidPipe) inviteId: string,
  ) {
    const data = await this.proxy.sendChat<ChannelInviteView>(
      CHAT_PATTERNS.REVOKE_CHANNEL_INVITE,
      {
        actorId: user.id,
        conversationId: id,
        inviteId,
      },
    );
    return { message: 'Channel invite revoked successfully', data };
  }

  @Public()
  @Get('channel-invites/:token')
  async previewChannelInvite(@Param('token') token: string) {
    const data = await this.proxy.sendChat<ChannelInvitePreviewView>(
      CHAT_PATTERNS.PREVIEW_CHANNEL_INVITE,
      { token },
      { skipTenant: true },
    );
    return { message: 'Channel invite preview', data };
  }

  @Post('channel-invites/:token/accept')
  @HttpCode(HttpStatus.OK)
  async acceptChannelInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('token') token: string,
  ) {
    const data = await this.proxy.sendChat<ConversationView>(
      CHAT_PATTERNS.ACCEPT_CHANNEL_INVITE,
      { actorId: user.id, token },
      { skipTenant: true },
    );
    await this.presence.attachToConversations([data]);
    const memberIds = data.members.map((member) => member.userId);
    await this.conversationCache.setMemberIds(data.id, memberIds);
    this.chatGateway.broadcastConversationUpdated(data, memberIds);
    return { message: CHAT_SUCCESS_MESSAGES.MEMBERS_ADDED, data };
  }

  @Post('conversations/:id/incoming-webhooks')
  @HttpCode(HttpStatus.CREATED)
  async createIncomingWebhook(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: CreateIncomingWebhookDto,
  ) {
    const data = await this.proxy.sendChat<IncomingWebhookView>(
      CHAT_PATTERNS.CREATE_INCOMING_WEBHOOK,
      {
        actorId: user.id,
        conversationId: id,
        name: dto.name,
        defaultUsername: dto.defaultUsername,
        defaultIconUrl: dto.defaultIconUrl ?? null,
      },
    );
    return { message: 'Incoming webhook created successfully', data };
  }

  @Get('conversations/:id/incoming-webhooks')
  async listIncomingWebhooks(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: ChatPageQueryDto,
  ) {
    const data = await this.proxy.sendChat(
      CHAT_PATTERNS.LIST_INCOMING_WEBHOOKS,
      {
        actorId: user.id,
        conversationId: id,
        page: query.page,
        limit: query.limit,
      },
    );
    return { message: 'Incoming webhooks retrieved successfully', data };
  }

  @Delete('conversations/:id/incoming-webhooks/:webhookId')
  @HttpCode(HttpStatus.OK)
  async revokeIncomingWebhook(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('webhookId', ParseUuidPipe) webhookId: string,
  ) {
    const data = await this.proxy.sendChat<IncomingWebhookView>(
      CHAT_PATTERNS.REVOKE_INCOMING_WEBHOOK,
      {
        actorId: user.id,
        conversationId: id,
        webhookId,
      },
    );
    return { message: 'Incoming webhook revoked successfully', data };
  }

  @Post('conversations/:id/outgoing-webhooks')
  @HttpCode(HttpStatus.CREATED)
  async createOutgoingWebhook(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: CreateOutgoingWebhookDto,
  ) {
    const data = await this.proxy.sendChat<OutgoingWebhookView>(
      CHAT_PATTERNS.CREATE_OUTGOING_WEBHOOK,
      {
        actorId: user.id,
        conversationId: id,
        name: dto.name,
        targetUrl: dto.targetUrl,
        excludeBots: dto.excludeBots,
      },
    );
    return { message: 'Outgoing webhook created successfully', data };
  }

  @Get('conversations/:id/outgoing-webhooks')
  async listOutgoingWebhooks(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: ChatPageQueryDto,
  ) {
    const data = await this.proxy.sendChat(
      CHAT_PATTERNS.LIST_OUTGOING_WEBHOOKS,
      {
        actorId: user.id,
        conversationId: id,
        page: query.page,
        limit: query.limit,
      },
    );
    return { message: 'Outgoing webhooks retrieved successfully', data };
  }

  @Delete('conversations/:id/outgoing-webhooks/:webhookId')
  @HttpCode(HttpStatus.OK)
  async revokeOutgoingWebhook(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('webhookId', ParseUuidPipe) webhookId: string,
  ) {
    const data = await this.proxy.sendChat<OutgoingWebhookView>(
      CHAT_PATTERNS.REVOKE_OUTGOING_WEBHOOK,
      {
        actorId: user.id,
        conversationId: id,
        webhookId,
      },
    );
    return { message: 'Outgoing webhook revoked successfully', data };
  }

  @Get('slash-commands')
  async listSlashCommands(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ChatPageQueryDto,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.LIST_SLASH_COMMANDS, {
      actorId: user.id,
      page: query.page,
      limit: query.limit,
    });
    return { message: 'Slash commands retrieved successfully', data };
  }

  @Post('slash-commands')
  @HttpCode(HttpStatus.CREATED)
  async createSlashCommand(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSlashCommandDto,
    @Req() request: Request & { organization?: OrganizationView },
  ) {
    this.assertWorkspaceManager(request);
    const data = await this.proxy.sendChat<SlashCommandView>(
      CHAT_PATTERNS.CREATE_SLASH_COMMAND,
      {
        actorId: user.id,
        name: dto.name,
        description: dto.description,
        responseTemplate: dto.responseTemplate,
        responseMode: dto.responseMode,
        requestUrl: dto.requestUrl ?? null,
      },
    );
    return { message: 'Slash command created successfully', data };
  }

  @Delete('slash-commands/:commandId')
  @HttpCode(HttpStatus.OK)
  async revokeSlashCommand(
    @CurrentUser() user: AuthenticatedUser,
    @Param('commandId', ParseUuidPipe) commandId: string,
    @Req() request: Request & { organization?: OrganizationView },
  ) {
    this.assertWorkspaceManager(request);
    const data = await this.proxy.sendChat<SlashCommandView>(
      CHAT_PATTERNS.REVOKE_SLASH_COMMAND,
      { actorId: user.id, commandId },
    );
    return { message: 'Slash command revoked successfully', data };
  }

  @Post('conversations/:id/slash')
  @HttpCode(HttpStatus.OK)
  async invokeSlashCommand(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: InvokeSlashCommandDto,
  ) {
    const result = await this.proxy.sendChat<InvokeSlashCommandResult>(
      CHAT_PATTERNS.INVOKE_SLASH_COMMAND,
      {
        actorId: user.id,
        conversationId: id,
        raw: dto.raw,
      },
    );

    if (result.kind === 'status') {
      const presence = await this.presence.setStatus(
        user.id,
        PresenceStatus.ONLINE,
        result.customStatus ?? null,
      );
      this.chatGateway.emitPresenceUpdate(presence);
      return {
        message: 'Status updated',
        data: {
          kind: result.kind,
          ephemeral: result.ephemeral ?? null,
          customStatus: result.customStatus ?? null,
        },
      };
    }

    if (result.kind === 'ephemeral') {
      return {
        message: 'Slash command executed',
        data: { kind: result.kind, ephemeral: result.ephemeral ?? '' },
      };
    }

    const messageResult = result.message;
    if (!messageResult) {
      throw new BadRequestAppException('Slash command produced no message');
    }
    const { recipientIds, ...message } = messageResult;
    this.chatGateway.broadcastMessage(message, recipientIds);
    this.dispatchOutgoingWebhooksForMessage(message);
    return {
      message: 'Slash command executed',
      data: { kind: 'message' as const, message },
    };
  }

  @Get('user-groups')
  async listUserGroups(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ChatPageQueryDto,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.LIST_USER_GROUPS, {
      actorId: user.id,
      page: query.page,
      limit: query.limit,
    });
    return { message: 'User groups retrieved successfully', data };
  }

  @Post('user-groups')
  @HttpCode(HttpStatus.CREATED)
  async createUserGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateUserGroupDto,
    @Req() request: Request & { organization?: OrganizationView },
  ) {
    this.assertWorkspaceManager(request);
    const data = await this.proxy.sendChat<UserGroupView>(
      CHAT_PATTERNS.CREATE_USER_GROUP,
      {
        actorId: user.id,
        handle: dto.handle,
        name: dto.name,
        description: dto.description ?? null,
        memberIds: dto.memberIds,
      },
    );
    return { message: 'User group created successfully', data };
  }

  @Patch('user-groups/:groupId')
  async updateUserGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUuidPipe) groupId: string,
    @Body() dto: UpdateUserGroupDto,
    @Req() request: Request & { organization?: OrganizationView },
  ) {
    this.assertWorkspaceManager(request);
    const data = await this.proxy.sendChat<UserGroupView>(
      CHAT_PATTERNS.UPDATE_USER_GROUP,
      {
        actorId: user.id,
        groupId,
        handle: dto.handle,
        name: dto.name,
        description: dto.description,
        memberIds: dto.memberIds,
      },
    );
    return { message: 'User group updated successfully', data };
  }

  @Delete('user-groups/:groupId')
  @HttpCode(HttpStatus.OK)
  async deleteUserGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUuidPipe) groupId: string,
    @Req() request: Request & { organization?: OrganizationView },
  ) {
    this.assertWorkspaceManager(request);
    const data = await this.proxy.sendChat<{ deleted: boolean }>(
      CHAT_PATTERNS.DELETE_USER_GROUP,
      { actorId: user.id, groupId },
    );
    return { message: 'User group deleted successfully', data };
  }

  @Get('conversations/:id/media')
  async listMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: ListMediaQueryDto,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.LIST_MEDIA, {
      actorId: user.id,
      conversationId: id,
      page: query.page,
      limit: query.limit,
      kind: query.kind,
    });
    return { message: CHAT_SUCCESS_MESSAGES.MEDIA_FETCHED, data };
  }

  @Get('conversations/:id/messages/:messageId/download')
  async downloadAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('messageId', ParseUuidPipe) messageId: string,
    @Query('disposition') disposition: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const message = await this.proxy.sendChat<MessageView>(
      CHAT_PATTERNS.GET_MESSAGE,
      {
        actorId: user.id,
        conversationId: id,
        messageId,
      },
    );
    if (!message.attachment?.url || message.deletedForEveryone) {
      throw new NotFoundAppException('Attachment not found');
    }

    const filename = (message.attachment.name || `relay-${messageId}`).replace(
      /[\\/:*?"<>|]+/g,
      '_',
    );
    const inline = disposition === 'inline';
    const contentType = resolveAttachmentContentType(
      message.attachment.mime,
      filename,
    );

    try {
      const buffer = await this.storage.downloadBuffer(message.attachment.url);
      res.setHeader('Content-Type', contentType);
      res.setHeader(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/"/g, '')}"`,
      );
      res.setHeader('Cache-Control', 'private, max-age=60');
      // Allow the SPA to open this blob in a new tab / iframe
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return new StreamableFile(buffer);
    } catch {
      // Last resort: redirect to a signed Cloudinary URL (bypasses public 401)
      const signed = this.storage.resolveDownloadUrl(message.attachment.url, {
        filename,
      });
      return res.redirect(signed);
    }
  }

  @Get('conversations/:id/messages')
  @ListMessagesDocs()
  async listMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: ChatPageQueryDto,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.LIST_MESSAGES, {
      actorId: user.id,
      conversationId: id,
      page: query.page,
      limit: query.limit,
    });
    return { message: CHAT_SUCCESS_MESSAGES.MESSAGES_FETCHED, data };
  }

  @Post('conversations/:id/messages')
  @HttpCode(HttpStatus.CREATED)
  @SendMessageDocs()
  async sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    if (dto.type === 'call') {
      throw new BadRequestException(
        'Call history messages are system-generated only',
      );
    }

    let onlineUserIds: string[] | undefined;
    const bodyText = dto.body ?? '';
    if (/(^|[\s([{])@here\b/i.test(bodyText)) {
      let memberIds = await this.conversationCache.getMemberIds(id);
      if (!memberIds || memberIds.length === 0) {
        const conversation = await this.proxy.sendChat<ConversationView>(
          CHAT_PATTERNS.GET_CONVERSATION,
          { actorId: user.id, conversationId: id },
        );
        memberIds = conversation.members.map((member) => member.userId);
        await this.conversationCache.setMemberIds(id, memberIds);
      }
      const presence = await this.presence.getPresenceMap(
        memberIds.filter((memberId) => memberId !== user.id),
      );
      onlineUserIds = [...presence.entries()]
        .filter(([, view]) => view.status !== PresenceStatus.OFFLINE)
        .map(([memberId]) => memberId);
    }

    const result = await this.proxy.sendChat<SendMessageResult>(
      CHAT_PATTERNS.SEND_MESSAGE,
      {
        actorId: user.id,
        conversationId: id,
        body: dto.body,
        type: dto.type,
        replyToMessageId: dto.replyToMessageId,
        threadRootId: dto.threadRootId,
        attachmentUrl: dto.attachmentUrl,
        attachmentMime: dto.attachmentMime,
        attachmentName: dto.attachmentName,
        attachmentSize: dto.attachmentSize,
        mentionUserIds: dto.mentionUserIds,
        onlineUserIds,
        alsoSendToChannel: dto.alsoSendToChannel,
        linkPreview: dto.linkPreview ?? null,
      },
    );
    const {
      recipientIds,
      mutedRecipientIds,
      pushRecipientIds,
      channelBroadcast,
      ...data
    } = result;
    await this.conversationCache.setMemberIds(id, recipientIds);
    this.chatGateway.broadcastMessage(data, recipientIds);
    if (channelBroadcast) {
      this.chatGateway.broadcastMessage(channelBroadcast, recipientIds);
    }
    void this.push.notifyOfflineRecipients({
      recipientIds: pushRecipientIds ?? recipientIds,
      senderId: user.id,
      title: data.threadRootId ? 'New thread reply' : 'New Relay message',
      body: (data.body || 'Attachment').slice(0, 120),
      conversationId: id,
      mentionUserIds: data.mentions ?? dto.mentionUserIds ?? [],
      mutedRecipientIds: mutedRecipientIds ?? [],
    });
    this.dispatchOutgoingWebhooksForMessage(data);
    if (channelBroadcast) {
      this.dispatchOutgoingWebhooksForMessage(channelBroadcast);
    }
    void this.evaluateChannelWorkflows(user.id, id, 'message_contains', data);
    return { message: CHAT_SUCCESS_MESSAGES.MESSAGE_SENT, data };
  }

  @Get('push/vapid-public-key')
  getPushPublicKey() {
    return {
      message: 'Push public key',
      data: {
        publicKey: this.push.getPublicKey(),
        enabled: this.push.isEnabled(),
      },
    };
  }

  @Get('notification-prefs')
  async getNotificationPrefs(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.notificationPrefs.get(user.id);
    return { message: 'Notification preferences retrieved', data };
  }

  @Patch('notification-prefs')
  async updateNotificationPrefs(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNotificationPrefsDto,
  ) {
    const data = await this.notificationPrefs.set(user.id, dto);
    return { message: 'Notification preferences updated', data };
  }

  @Get('conversations/:id/notification-prefs')
  async getChannelNotificationPrefs(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
  ) {
    await this.proxy.sendChat(CHAT_PATTERNS.GET_CONVERSATION, {
      actorId: user.id,
      conversationId: id,
    });
    const mode = await this.notificationPrefs.getChannelMode(user.id, id);
    return {
      message: 'Channel notification preferences retrieved',
      data: { conversationId: id, mode },
    };
  }

  @Put('conversations/:id/notification-prefs')
  async updateChannelNotificationPrefs(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateChannelNotificationPrefsDto,
  ) {
    await this.proxy.sendChat(CHAT_PATTERNS.GET_CONVERSATION, {
      actorId: user.id,
      conversationId: id,
    });
    const data = await this.notificationPrefs.setChannelMode(
      user.id,
      id,
      dto.mode,
    );
    return {
      message: 'Channel notification preferences updated',
      data,
    };
  }

  /** ICE servers for WebRTC voice calls (STUN always; TURN only if configured). */
  @Get('webrtc-config')
  getWebRtcConfig(@CurrentUser() _user: AuthenticatedUser) {
    return {
      message: 'WebRTC config',
      data: {
        iceServers: this.chatGateway.getIceServers(),
      },
    };
  }

  /** Ongoing group call lobby for rejoin (WhatsApp-style Join). */
  @Get('conversations/:id/active-call')
  async getActiveCall(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
  ) {
    // Ensure membership
    await this.proxy.sendChat(CHAT_PATTERNS.GET_CONVERSATION, {
      actorId: user.id,
      conversationId: id,
    });
    const session = await this.calls.getByConversation(id);
    if (
      !session ||
      session.kind !== 'group' ||
      session.joinedIds.length === 0
    ) {
      return {
        message: 'No active call',
        data: null,
      };
    }
    if (!session.memberIds.includes(user.id)) {
      return {
        message: 'No active call',
        data: null,
      };
    }
    return {
      message: 'Active call',
      data: this.calls.toLobby(session, true),
    };
  }

  @Post('push/subscribe')
  @HttpCode(HttpStatus.CREATED)
  async subscribePush(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    },
  ) {
    if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
      throw new BadRequestAppException('Invalid push subscription');
    }
    await this.push.subscribe(user.id, body);
    return {
      message: 'Push subscription saved',
      data: { subscribed: true },
    };
  }

  @Delete('push/subscribe')
  async unsubscribePush(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { endpoint?: string } = {},
  ) {
    await this.push.unsubscribe(user.id, body.endpoint);
    return {
      message: 'Push subscription removed',
      data: { subscribed: false },
    };
  }

  @Patch('conversations/:id/messages/:messageId')
  async editMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('messageId', ParseUuidPipe) messageId: string,
    @Body() dto: EditMessageDto,
  ) {
    const result = await this.proxy.sendChat<SendMessageResult>(
      CHAT_PATTERNS.EDIT_MESSAGE,
      {
        actorId: user.id,
        conversationId: id,
        messageId,
        body: dto.body,
      },
    );
    const { recipientIds, ...data } = result;
    await this.conversationCache.setMemberIds(id, recipientIds);
    this.chatGateway.broadcastMessage(data, recipientIds);
    return { message: CHAT_SUCCESS_MESSAGES.MESSAGE_EDITED, data };
  }

  @Get('conversations/:id/messages/:messageId/edits')
  async listMessageEdits(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('messageId', ParseUuidPipe) messageId: string,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.LIST_MESSAGE_EDITS, {
      actorId: user.id,
      conversationId: id,
      messageId,
    });
    return { message: 'Message edit history loaded', data };
  }

  @Post('conversations/:id/messages/:messageId/reactions')
  async reactMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('messageId', ParseUuidPipe) messageId: string,
    @Body() dto: ReactMessageDto,
  ) {
    const result = await this.proxy.sendChat<SendMessageResult>(
      CHAT_PATTERNS.REACT_MESSAGE,
      {
        actorId: user.id,
        conversationId: id,
        messageId,
        emoji: dto.emoji,
      },
    );
    const { recipientIds, ...data } = result;
    await this.conversationCache.setMemberIds(id, recipientIds);
    this.chatGateway.broadcastMessage(data, recipientIds);
    return { message: CHAT_SUCCESS_MESSAGES.MESSAGE_REACTED, data };
  }

  @Post('conversations/:id/messages/:messageId/pin')
  async pinMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('messageId', ParseUuidPipe) messageId: string,
    @Body() dto: PinMessageDto,
  ) {
    const result = await this.proxy.sendChat<SendMessageResult>(
      CHAT_PATTERNS.PIN_MESSAGE,
      {
        actorId: user.id,
        conversationId: id,
        messageId,
        pinned: dto.pinned,
      },
    );
    const { recipientIds, ...data } = result;
    await this.conversationCache.setMemberIds(id, recipientIds);
    this.chatGateway.broadcastMessage(data, recipientIds);
    return { message: CHAT_SUCCESS_MESSAGES.MESSAGE_PINNED, data };
  }

  @Post('conversations/:id/polls')
  @HttpCode(HttpStatus.CREATED)
  async createPoll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: CreatePollDto,
  ) {
    const result = await this.proxy.sendChat<SendMessageResult>(
      CHAT_PATTERNS.CREATE_POLL,
      {
        actorId: user.id,
        conversationId: id,
        question: dto.question,
        options: dto.options,
        allowMultiple: dto.allowMultiple,
      },
    );
    const { recipientIds, mutedRecipientIds, ...data } = result;
    await this.conversationCache.setMemberIds(id, recipientIds);
    this.chatGateway.broadcastMessage(data, recipientIds);
    void this.push.notifyOfflineRecipients({
      recipientIds,
      senderId: user.id,
      title: 'New Relay poll',
      body: (data.body || 'Poll').slice(0, 120),
      conversationId: id,
      mutedRecipientIds: mutedRecipientIds ?? [],
    });
    return { message: 'Poll created', data };
  }

  @Post('conversations/:id/messages/:messageId/poll-votes')
  @HttpCode(HttpStatus.OK)
  async votePoll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('messageId', ParseUuidPipe) messageId: string,
    @Body() dto: VotePollDto,
  ) {
    const result = await this.proxy.sendChat<SendMessageResult>(
      CHAT_PATTERNS.VOTE_POLL,
      {
        actorId: user.id,
        conversationId: id,
        messageId,
        optionId: dto.optionId,
      },
    );
    const { recipientIds, mutedRecipientIds: _muted, ...data } = result;
    await this.conversationCache.setMemberIds(id, recipientIds);
    this.chatGateway.broadcastMessage(data, recipientIds);
    return { message: 'Vote recorded', data };
  }

  @Get('bookmarks')
  async listBookmarks(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ChatPageQueryDto,
    @Query('conversationId') conversationId?: string,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.LIST_BOOKMARKS, {
      actorId: user.id,
      page: query.page,
      limit: query.limit,
      conversationId: conversationId?.trim() || undefined,
    });
    return { message: 'Bookmarks retrieved', data };
  }

  @Get('threads')
  async listMyThreads(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ChatPageQueryDto,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.LIST_MY_THREADS, {
      actorId: user.id,
      page: query.page,
      limit: query.limit,
    });
    return { message: 'Threads retrieved', data };
  }

  @Post('conversations/:id/threads/:threadRootId/follow')
  @HttpCode(HttpStatus.OK)
  async followThread(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('threadRootId', ParseUuidPipe) threadRootId: string,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.FOLLOW_THREAD, {
      actorId: user.id,
      conversationId: id,
      threadRootId,
    });
    return { message: 'Thread followed', data };
  }

  @Delete('conversations/:id/threads/:threadRootId/follow')
  @HttpCode(HttpStatus.OK)
  async unfollowThread(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('threadRootId', ParseUuidPipe) threadRootId: string,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.UNFOLLOW_THREAD, {
      actorId: user.id,
      conversationId: id,
      threadRootId,
    });
    return { message: 'Thread unfollowed', data };
  }

  @Post('conversations/:id/threads/:threadRootId/read')
  @HttpCode(HttpStatus.OK)
  async markThreadRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('threadRootId', ParseUuidPipe) threadRootId: string,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.MARK_THREAD_READ, {
      actorId: user.id,
      conversationId: id,
      threadRootId,
    });
    return { message: 'Thread marked read', data };
  }

  @Post('bookmarks')
  @HttpCode(HttpStatus.CREATED)
  async saveBookmark(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveBookmarkDto,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.SAVE_BOOKMARK, {
      actorId: user.id,
      messageId: dto.messageId,
    });
    return { message: 'Message saved', data };
  }

  @Delete('bookmarks/:messageId')
  async removeBookmark(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUuidPipe) messageId: string,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.REMOVE_BOOKMARK, {
      actorId: user.id,
      messageId,
    });
    return { message: 'Bookmark removed', data };
  }

  @Get('conversations/:id/pinned-messages')
  async listPinnedMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.LIST_PINNED_MESSAGES, {
      actorId: user.id,
      conversationId: id,
    });
    return { message: CHAT_SUCCESS_MESSAGES.PINNED_MESSAGES_FETCHED, data };
  }

  @Post('conversations/:id/scheduled-messages')
  @HttpCode(HttpStatus.CREATED)
  async scheduleMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: ScheduleMessageDto,
  ) {
    if (dto.type === 'call') {
      throw new BadRequestException(
        'Call history messages cannot be scheduled',
      );
    }
    const data = await this.proxy.sendChat(CHAT_PATTERNS.SCHEDULE_MESSAGE, {
      actorId: user.id,
      conversationId: id,
      body: dto.body,
      type: dto.type,
      replyToMessageId: dto.replyToMessageId,
      attachmentUrl: dto.attachmentUrl,
      attachmentMime: dto.attachmentMime,
      attachmentName: dto.attachmentName,
      attachmentSize: dto.attachmentSize,
      mentionUserIds: dto.mentionUserIds,
      linkPreview: dto.linkPreview ?? null,
      scheduledFor: dto.scheduledFor,
    });
    return { message: CHAT_SUCCESS_MESSAGES.MESSAGE_SCHEDULED, data };
  }

  @Get('conversations/:id/scheduled-messages')
  async listScheduledMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
  ) {
    const data = await this.proxy.sendChat(
      CHAT_PATTERNS.LIST_SCHEDULED_MESSAGES,
      { actorId: user.id, conversationId: id },
    );
    return { message: CHAT_SUCCESS_MESSAGES.SCHEDULED_MESSAGES_FETCHED, data };
  }

  @Delete('conversations/:id/scheduled-messages/:scheduledMessageId')
  async cancelScheduledMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('scheduledMessageId', ParseUuidPipe) scheduledMessageId: string,
  ) {
    const data = await this.proxy.sendChat(
      CHAT_PATTERNS.CANCEL_SCHEDULED_MESSAGE,
      {
        actorId: user.id,
        conversationId: id,
        scheduledMessageId,
      },
    );
    return { message: CHAT_SUCCESS_MESSAGES.SCHEDULED_MESSAGE_CANCELLED, data };
  }

  @Put('conversations/:id/draft')
  async upsertDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpsertDraftDto,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.UPSERT_DRAFT, {
      actorId: user.id,
      conversationId: id,
      body: dto.body,
    });
    return { message: 'Draft saved', data };
  }

  @Get('conversations/:id/draft')
  async getDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.GET_DRAFT, {
      actorId: user.id,
      conversationId: id,
    });
    return { message: 'Draft retrieved', data };
  }

  @Delete('conversations/:id/draft')
  async clearDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.CLEAR_DRAFT, {
      actorId: user.id,
      conversationId: id,
    });
    return { message: 'Draft cleared', data };
  }

  @Post('conversations/:id/messages/:messageId/remind')
  @HttpCode(HttpStatus.CREATED)
  async createReminder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('messageId', ParseUuidPipe) messageId: string,
    @Body() dto: CreateReminderDto,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.CREATE_REMINDER, {
      actorId: user.id,
      conversationId: id,
      messageId,
      remindAt: dto.remindAt,
    });
    return { message: 'Reminder created', data };
  }

  @Get('reminders')
  async listReminders(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ChatPageQueryDto,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.LIST_REMINDERS, {
      actorId: user.id,
      page: query.page,
      limit: query.limit,
    });
    return { message: 'Reminders retrieved', data };
  }

  @Delete('reminders/:id')
  async cancelReminder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) reminderId: string,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.CANCEL_REMINDER, {
      actorId: user.id,
      reminderId,
    });
    return { message: 'Reminder cancelled', data };
  }

  @Post('conversations/:id/messages/:messageId/forward')
  @HttpCode(HttpStatus.CREATED)
  async forwardMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('messageId', ParseUuidPipe) messageId: string,
    @Body() dto: ForwardMessageDto,
  ) {
    const result = await this.proxy.sendChat<SendMessageResult>(
      CHAT_PATTERNS.FORWARD_MESSAGE,
      {
        actorId: user.id,
        messageId,
        fromConversationId: id,
        toConversationId: dto.conversationId,
      },
    );
    const { recipientIds, ...data } = result;
    await this.conversationCache.setMemberIds(dto.conversationId, recipientIds);
    this.chatGateway.broadcastMessage(data, recipientIds);
    return { message: CHAT_SUCCESS_MESSAGES.MESSAGE_FORWARDED, data };
  }

  @Post('conversations/:id/summarize')
  @HttpCode(HttpStatus.OK)
  async summarizeConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
  ) {
    const data = await this.ai.summarizeConversation(user.id, id);
    return { message: 'Conversation summary ready', data };
  }

  @Get('conversations/:id/smart-replies')
  async smartReplies(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
  ) {
    const data = await this.ai.smartReplies(user.id, id);
    return { message: 'Smart replies ready', data };
  }

  @Post('conversations/:id/messages/:messageId/translate')
  @HttpCode(HttpStatus.OK)
  async translateMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('messageId', ParseUuidPipe) messageId: string,
    @Body() body: { targetLanguage?: string },
  ) {
    const data = await this.ai.translateMessage(
      user.id,
      id,
      messageId,
      body?.targetLanguage ?? 'en',
    );
    return { message: 'Translation ready', data };
  }

  @Post('uploads')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  async uploadFile(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: UploadedImage,
  ) {
    if (!file) {
      throw new BadRequestAppException('File is required');
    }
    const mimeType = normalizeUploadMime(file.mimetype, file.originalname);
    if (!mimeType) {
      throw new BadRequestException(
        'Only images (jpeg/png/gif/webp), audio (webm/ogg/mp3/mp4/wav), and common documents (pdf/doc/xls/ppt/txt/csv/zip/…) are allowed',
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestAppException('File must be 10MB or smaller');
    }

    const uploaded = await this.storage.upload({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType,
      size: file.size,
      userName: user.email,
    });

    return {
      message: CHAT_SUCCESS_MESSAGES.FILE_UPLOADED,
      data: {
        url: uploaded.url,
        key: uploaded.key,
        provider: uploaded.provider,
        mime: mimeType,
        name: uploaded.name,
        size: uploaded.size,
      },
    };
  }

  @Delete('conversations/:id/messages/:messageId')
  async deleteMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('messageId', ParseUuidPipe) messageId: string,
    @Body() dto: DeleteMessageDto = {},
  ) {
    const result = await this.proxy.sendChat<DeleteMessageResult>(
      CHAT_PATTERNS.DELETE_MESSAGE,
      {
        actorId: user.id,
        conversationId: id,
        messageId,
        forEveryone: dto.forEveryone,
      },
    );
    if (result.forEveryone) {
      await this.conversationCache.setMemberIds(id, result.recipientIds);
      this.chatGateway.broadcastMessageDeleted(
        result.message,
        result.recipientIds,
      );
      if (result.removedAttachmentUrl) {
        await this.storage.deleteByUrl(result.removedAttachmentUrl);
      }
    }
    return {
      message: CHAT_SUCCESS_MESSAGES.MESSAGE_DELETED,
      data: result.message,
    };
  }

  @Post('conversations/:id/mute')
  async muteConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: MuteConversationDto,
  ) {
    const data = await this.proxy.sendChat<ConversationView>(
      CHAT_PATTERNS.MUTE_CONVERSATION,
      {
        actorId: user.id,
        conversationId: id,
        muted: dto.muted,
      },
    );
    await this.presence.attachToConversations([data]);
    await this.applyLastSeenPrivacy([data]);
    return { message: CHAT_SUCCESS_MESSAGES.CONVERSATION_MUTED, data };
  }

  @Post('conversations/:id/pin')
  async pinConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: PinConversationDto,
  ) {
    const data = await this.proxy.sendChat<ConversationView>(
      CHAT_PATTERNS.PIN_CONVERSATION,
      {
        actorId: user.id,
        conversationId: id,
        pinned: dto.pinned,
      },
    );
    await this.presence.attachToConversations([data]);
    await this.applyLastSeenPrivacy([data]);
    return { message: CHAT_SUCCESS_MESSAGES.CONVERSATION_PINNED, data };
  }

  @Post('conversations/:id/disappearing')
  async setDisappearing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: SetDisappearingDto,
  ) {
    const data = await this.proxy.sendChat<ConversationView>(
      CHAT_PATTERNS.SET_DISAPPEARING,
      {
        actorId: user.id,
        conversationId: id,
        durationSeconds: dto.durationSeconds,
      },
    );
    await this.presence.attachToConversations([data]);
    await this.applyLastSeenPrivacy([data]);
    const memberIds = data.members.map((member) => member.userId);
    await this.conversationCache.setMemberIds(id, memberIds);
    this.chatGateway.broadcastConversationUpdated(data, memberIds);
    return { message: CHAT_SUCCESS_MESSAGES.DISAPPEARING_UPDATED, data };
  }

  @Post('conversations/:id/typing')
  @TypingDocs()
  async typing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: TypingDto,
  ) {
    const conversation = await this.proxy.sendChat<ConversationView>(
      CHAT_PATTERNS.GET_CONVERSATION,
      {
        actorId: user.id,
        conversationId: id,
      },
    );
    const memberIds = conversation.members.map((member) => member.userId);
    await this.conversationCache.setMemberIds(id, memberIds);
    this.chatGateway.broadcastTyping(id, user.id, dto.typing, memberIds);
    return {
      message: CHAT_SUCCESS_MESSAGES.TYPING_UPDATED,
      data: { ok: true, conversationId: id, typing: dto.typing },
    };
  }

  @Post('conversations/:id/seen')
  @MarkSeenDocs()
  async markSeen(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: MarkSeenDto = {},
  ) {
    const result = await this.proxy.sendChat<SeenResultView>(
      CHAT_PATTERNS.MARK_SEEN,
      {
        actorId: user.id,
        conversationId: id,
        messageId: dto.messageId,
      },
    );
    const { recipientIds, ...data } = result;
    await this.conversationCache.setMemberIds(id, recipientIds);
    this.chatGateway.broadcastSeen(data, recipientIds);
    return { message: CHAT_SUCCESS_MESSAGES.SEEN_UPDATED, data };
  }

  @Post('conversations/:id/unread')
  @MarkUnreadDocs()
  async markUnread(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: MarkUnreadDto,
  ) {
    const result = await this.proxy.sendChat<SeenResultView>(
      CHAT_PATTERNS.MARK_UNREAD,
      {
        actorId: user.id,
        conversationId: id,
        messageId: dto.messageId,
      },
    );
    const { recipientIds, ...data } = result;
    await this.conversationCache.setMemberIds(id, recipientIds);
    this.chatGateway.broadcastUnseen(data, recipientIds);
    return { message: CHAT_SUCCESS_MESSAGES.UNREAD_UPDATED, data };
  }

  @Post('conversations/:id/members')
  @AddMembersDocs()
  async addMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: AddMembersDto,
  ) {
    await this.assertUsersExist(dto.memberIds);
    const data = await this.proxy.sendChat<ConversationView>(
      CHAT_PATTERNS.ADD_MEMBERS,
      {
        actorId: user.id,
        conversationId: id,
        memberIds: dto.memberIds,
      },
    );
    await this.presence.attachToConversations([data]);
    const memberIds = data.members.map((member) => member.userId);
    await this.conversationCache.setMemberIds(id, memberIds);
    // Fan-out so newly added users see the group in their inbox without refresh
    this.chatGateway.broadcastConversationUpdated(data, memberIds);
    return { message: CHAT_SUCCESS_MESSAGES.MEMBERS_ADDED, data };
  }

  @Patch('conversations/:id/members/:userId/role')
  async setMemberRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('userId', ParseUuidPipe) userId: string,
    @Body() dto: SetMemberRoleDto,
  ) {
    const data = await this.proxy.sendChat<ConversationView>(
      CHAT_PATTERNS.SET_MEMBER_ROLE,
      {
        actorId: user.id,
        conversationId: id,
        memberId: userId,
        role: dto.role,
      },
    );
    await this.presence.attachToConversations([data]);
    await this.applyLastSeenPrivacy([data]);
    const memberIds = data.members.map((member) => member.userId);
    this.chatGateway.broadcastConversationUpdated(data, memberIds);
    return { message: CHAT_SUCCESS_MESSAGES.MEMBER_ROLE_UPDATED, data };
  }

  @Delete('conversations/:id/members/:userId')
  @RemoveMemberDocs()
  async removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('userId', ParseUuidPipe) userId: string,
  ) {
    const data = await this.proxy.sendChat<ConversationView>(
      CHAT_PATTERNS.REMOVE_MEMBER,
      { actorId: user.id, conversationId: id, memberId: userId },
    );
    await this.presence.attachToConversations([data]);
    const memberIds = data.members.map((member) => member.userId);
    await this.conversationCache.setMemberIds(id, memberIds);
    this.chatGateway.broadcastConversationUpdated(data, memberIds);
    this.chatGateway.broadcastRemovedFromGroup(id, [userId]);
    void this.chatGateway.evictUsersFromConversation(id, [userId]);
    return { message: CHAT_SUCCESS_MESSAGES.MEMBER_REMOVED, data };
  }

  @Post('conversations/:id/leave')
  @LeaveConversationDocs()
  async leave(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
  ) {
    const previousIds =
      (await this.conversationCache.getMemberIds(id)) ??
      (
        await this.proxy.sendChat<ConversationView>(
          CHAT_PATTERNS.GET_CONVERSATION,
          { actorId: user.id, conversationId: id },
        )
      ).members.map((member) => member.userId);

    const data = await this.proxy.sendChat<{ left: boolean }>(
      CHAT_PATTERNS.LEAVE,
      {
        actorId: user.id,
        conversationId: id,
      },
    );

    const remainingIds = previousIds.filter((memberId) => memberId !== user.id);
    await this.conversationCache.setMemberIds(id, remainingIds);
    this.chatGateway.broadcastRemovedFromGroup(id, [user.id]);
    void this.chatGateway.evictUsersFromConversation(id, [user.id]);

    if (remainingIds[0]) {
      try {
        const conversation = await this.proxy.sendChat<ConversationView>(
          CHAT_PATTERNS.GET_CONVERSATION,
          { actorId: remainingIds[0], conversationId: id },
        );
        await this.presence.attachToConversations([conversation]);
        this.chatGateway.broadcastConversationUpdated(
          conversation,
          remainingIds,
        );
      } catch {
        // Remaining members will refresh on next open
      }
    }

    return { message: CHAT_SUCCESS_MESSAGES.LEFT, data };
  }

  @Patch('conversations/:id')
  @UpdateGroupDocs()
  async updateGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateGroupDto,
  ) {
    const data = await this.proxy.sendChat<ConversationView>(
      CHAT_PATTERNS.UPDATE_GROUP,
      {
        actorId: user.id,
        conversationId: id,
        name: dto.name,
        visibility: dto.visibility,
        announceOnly: dto.announceOnly,
        topic: dto.topic,
        description: dto.description,
      },
    );
    await this.presence.attachToConversations([data]);
    const memberIds = data.members.map((member) => member.userId);
    this.chatGateway.broadcastConversationUpdated(data, memberIds);
    return { message: CHAT_SUCCESS_MESSAGES.GROUP_UPDATED, data };
  }

  @Post('conversations/:id/channel-bookmarks')
  @HttpCode(HttpStatus.CREATED)
  async addChannelBookmark(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: AddChannelBookmarkDto,
  ) {
    const data = await this.proxy.sendChat<ConversationView>(
      CHAT_PATTERNS.ADD_CHANNEL_BOOKMARK,
      {
        actorId: user.id,
        conversationId: id,
        title: dto.title,
        url: dto.url,
      },
    );
    await this.presence.attachToConversations([data]);
    const memberIds = data.members.map((member) => member.userId);
    this.chatGateway.broadcastConversationUpdated(data, memberIds);
    return { message: 'Channel bookmark added', data };
  }

  @Delete('conversations/:id/channel-bookmarks/:bookmarkId')
  @HttpCode(HttpStatus.OK)
  async removeChannelBookmark(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('bookmarkId', ParseUuidPipe) bookmarkId: string,
  ) {
    const data = await this.proxy.sendChat<ConversationView>(
      CHAT_PATTERNS.REMOVE_CHANNEL_BOOKMARK,
      {
        actorId: user.id,
        conversationId: id,
        bookmarkId,
      },
    );
    await this.presence.attachToConversations([data]);
    const memberIds = data.members.map((member) => member.userId);
    this.chatGateway.broadcastConversationUpdated(data, memberIds);
    return { message: 'Channel bookmark removed', data };
  }

  @Get('sidebar/sections')
  async listSidebarSections(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.proxy.sendChat(
      CHAT_PATTERNS.LIST_SIDEBAR_SECTIONS,
      {
        actorId: user.id,
      },
    );
    return { message: 'Sidebar sections loaded', data };
  }

  @Post('sidebar/sections')
  @HttpCode(HttpStatus.CREATED)
  async createSidebarSection(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSidebarSectionDto,
  ) {
    const data = await this.proxy.sendChat(
      CHAT_PATTERNS.CREATE_SIDEBAR_SECTION,
      {
        actorId: user.id,
        name: dto.name,
      },
    );
    return { message: 'Sidebar section created', data };
  }

  @Patch('sidebar/sections/:sectionId')
  async updateSidebarSection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sectionId', ParseUuidPipe) sectionId: string,
    @Body() dto: UpdateSidebarSectionDto,
  ) {
    const data = await this.proxy.sendChat(
      CHAT_PATTERNS.UPDATE_SIDEBAR_SECTION,
      {
        actorId: user.id,
        sectionId,
        ...dto,
      },
    );
    return { message: 'Sidebar section updated', data };
  }

  @Delete('sidebar/sections/:sectionId')
  async deleteSidebarSection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sectionId', ParseUuidPipe) sectionId: string,
  ) {
    const data = await this.proxy.sendChat(
      CHAT_PATTERNS.DELETE_SIDEBAR_SECTION,
      {
        actorId: user.id,
        sectionId,
      },
    );
    return { message: 'Sidebar section deleted', data };
  }

  @Delete('conversations/:id')
  @HttpCode(HttpStatus.OK)
  @DeleteGroupDocs()
  async deleteGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
  ) {
    const data = await this.proxy.sendChat<{
      deleted: boolean;
      recipientIds: string[];
    }>(CHAT_PATTERNS.DELETE_GROUP, {
      actorId: user.id,
      conversationId: id,
    });
    await this.conversationCache.invalidate(id);
    this.chatGateway.broadcastGroupDeleted(id, data.recipientIds);
    const { recipientIds: _recipientIds, ...result } = data;
    return { message: CHAT_SUCCESS_MESSAGES.GROUP_DELETED, data: result };
  }

  @Post('blocks')
  @HttpCode(HttpStatus.CREATED)
  async blockUser(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BlockUserDto,
  ) {
    if (dto.userId === user.id) {
      throw new BadRequestAppException('You cannot block yourself');
    }
    await this.assertUserExists(dto.userId);
    const data = await this.proxy.sendChat<BlockView>(
      CHAT_PATTERNS.BLOCK_USER,
      {
        actorId: user.id,
        userId: dto.userId,
      },
    );
    return { message: CHAT_SUCCESS_MESSAGES.USER_BLOCKED, data };
  }

  @Delete('blocks/:userId')
  async unblockUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', ParseUuidPipe) userId: string,
  ) {
    const data = await this.proxy.sendChat<{ unblocked: boolean }>(
      CHAT_PATTERNS.UNBLOCK_USER,
      { actorId: user.id, userId },
    );
    return { message: CHAT_SUCCESS_MESSAGES.USER_UNBLOCKED, data };
  }

  @Get('blocks')
  async listBlocks(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ChatPageQueryDto,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.LIST_BLOCKS, {
      actorId: user.id,
      page: query.page,
      limit: query.limit,
    });
    return { message: CHAT_SUCCESS_MESSAGES.BLOCKS_FETCHED, data };
  }

  private async applyLastSeenPrivacy(
    conversations: ConversationView[],
  ): Promise<void> {
    const userIds = [
      ...new Set(
        conversations.flatMap((conversation) =>
          conversation.members
            .filter(
              (member) =>
                member.status === PresenceStatus.OFFLINE &&
                member.lastSeenAt != null,
            )
            .map((member) => member.userId),
        ),
      ),
    ];
    if (userIds.length === 0) {
      return;
    }

    const profiles = await Promise.all(
      userIds.map(async (userId) => {
        try {
          const profile = await this.proxy.sendUser<UserProfileView>(
            USER_PATTERNS.FIND_BY_USER_ID,
            { userId },
          );
          return { userId, showLastSeen: profile.showLastSeen !== false };
        } catch {
          return { userId, showLastSeen: true };
        }
      }),
    );

    const hidden = new Set(
      profiles.filter((item) => !item.showLastSeen).map((item) => item.userId),
    );
    if (hidden.size === 0) {
      return;
    }

    for (const conversation of conversations) {
      for (const member of conversation.members) {
        if (hidden.has(member.userId)) {
          member.lastSeenAt = null;
        }
      }
    }
  }

  private async stripLastSeenIfHidden(presence: PresenceView): Promise<void> {
    if (presence.status !== PresenceStatus.OFFLINE || !presence.lastSeenAt) {
      return;
    }
    try {
      const profile = await this.proxy.sendUser<UserProfileView>(
        USER_PATTERNS.FIND_BY_USER_ID,
        { userId: presence.userId },
      );
      if (profile.showLastSeen === false) {
        presence.lastSeenAt = null;
      }
    } catch {
      // Keep lastSeenAt if profile lookup fails
    }
  }

  private dispatchOutgoingWebhooksForMessage(
    message: MessageView,
    options?: { skipTenant?: boolean },
  ): void {
    void this.proxy.sendChat(
      CHAT_PATTERNS.DISPATCH_OUTGOING_WEBHOOKS,
      {
        conversationId: message.conversationId,
        event: 'message.created' as const,
        message: {
          id: message.id,
          body: message.body ?? null,
          senderId: message.senderId,
          type: message.type,
          createdAt: message.createdAt,
          botUsername: message.botUsername ?? null,
        },
      },
      options,
    );
  }

  private async evaluateChannelWorkflows(
    actorId: string,
    conversationId: string,
    triggerType: 'message_contains' | 'channel_created',
    message?: MessageView,
  ): Promise<void> {
    try {
      const result = (await this.proxy.sendChat(CHAT_PATTERNS.EVALUATE_WORKFLOWS, {
        actorId,
        conversationId,
        triggerType,
        message: message
          ? {
              id: message.id,
              body: message.body ?? '',
              senderId: message.senderId,
              botUsername: message.botUsername ?? null,
              conversationId: message.conversationId,
            }
          : null,
      })) as {
        messages?: Array<MessageView & { recipientIds?: string[] }>;
      };
      for (const item of result.messages ?? []) {
        const { recipientIds, ...view } = item;
        this.chatGateway.broadcastMessage(view, recipientIds ?? []);
        this.dispatchOutgoingWebhooksForMessage(view);
      }
    } catch {
      // Workflow failures must not break chat delivery.
    }
  }

  private async assertUserExists(userId: string): Promise<void> {
    try {
      await this.proxy.sendUser(USER_PATTERNS.FIND_BY_USER_ID, { userId });
    } catch {
      throw new NotFoundAppException('User');
    }
  }

  private async assertUsersExist(userIds: string[]): Promise<void> {
    await Promise.all(userIds.map((userId) => this.assertUserExists(userId)));
  }
}
