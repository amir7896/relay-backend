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
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  AuthenticatedUser,
  BadRequestAppException,
  CHAT_SUCCESS_MESSAGES,
  CurrentUser,
  NotFoundAppException,
  ParseUuidPipe,
  PresenceStatus,
} from '@app/common';
import type { PaginatedResult } from '@app/common';
import { CHAT_PATTERNS, USER_PATTERNS } from '@app/contracts';
import type {
  BlockView,
  ConversationView,
  DeleteMessageResult,
  MessageView,
  PresenceView,
  SeenResultView,
  SendMessageResult,
  UserProfileView,
} from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { StorageService } from '../storage/storage.service';
import { ChatGateway } from './chat.gateway';
import { CallSessionService } from './call-session.service';
import { ConversationCacheService } from './conversation-cache.service';
import { PushService } from './push.service';
import {
  AddMembersDto,
  BlockUserDto,
  ChatPageQueryDto,
  CreateGroupChatDto,
  CreatePrivateChatDto,
  DeleteMessageDto,
  EditMessageDto,
  ForwardMessageDto,
  ListMediaQueryDto,
  MarkSeenDto,
  MuteConversationDto,
  PinConversationDto,
  ReactMessageDto,
  SearchMessagesQueryDto,
  SendMessageDto,
  SetMemberRoleDto,
  TypingDto,
  UpdateGroupDto,
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
  '.xlsx':
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
    private readonly calls: CallSessionService,
  ) {}

  @Post('private')
  @HttpCode(HttpStatus.CREATED)
  @CreatePrivateChatDocs()
  async createPrivate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePrivateChatDto,
  ) {
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
  ) {
    await this.assertUsersExist(dto.memberIds.filter((id) => id !== user.id));
    const data = await this.proxy.sendChat<ConversationView>(
      CHAT_PATTERNS.CREATE_GROUP,
      { actorId: user.id, name: dto.name, memberIds: dto.memberIds },
    );
    await this.presence.attachToConversations([data]);
    const memberIds = data.members.map((member) => member.userId);
    await this.conversationCache.setMemberIds(data.id, memberIds);
    this.chatGateway.broadcastConversationUpdated(data, memberIds);
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

  @Get('presence/:userId')
  @GetPresenceDocs()
  async getPresence(@Param('userId', ParseUuidPipe) userId: string) {
    const data = await this.presence.getPresence(userId);
    await this.stripLastSeenIfHidden(data);
    return { message: CHAT_SUCCESS_MESSAGES.PRESENCE_FETCHED, data };
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
    const data = await this.proxy.sendChat(CHAT_PATTERNS.SEARCH_MESSAGES, {
      actorId: user.id,
      conversationId: id,
      query: query.q,
      page: query.page,
      limit: query.limit,
    });
    return { message: CHAT_SUCCESS_MESSAGES.MESSAGES_SEARCHED, data };
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

    const filename = (
      message.attachment.name ||
      `relay-${messageId}`
    ).replace(/[\\/:*?"<>|]+/g, '_');
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
    const result = await this.proxy.sendChat<SendMessageResult>(
      CHAT_PATTERNS.SEND_MESSAGE,
      {
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
      },
    );
    const { recipientIds, ...data } = result;
    await this.conversationCache.setMemberIds(id, recipientIds);
    this.chatGateway.broadcastMessage(data, recipientIds);
    void this.push.notifyOfflineRecipients({
      recipientIds,
      senderId: user.id,
      title: 'New Relay message',
      body: (data.body || 'Attachment').slice(0, 120),
      conversationId: id,
    });
    return { message: CHAT_SUCCESS_MESSAGES.MESSAGE_SENT, data };
  }

  @Get('push/vapid-public-key')
  getPushPublicKey() {
    return {
      message: 'Push public key',
      data: { publicKey: this.push.getPublicKey(), enabled: this.push.isEnabled() },
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
    if (!session || session.kind !== 'group' || session.joinedIds.length === 0) {
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
    await this.conversationCache.setMemberIds(
      dto.conversationId,
      recipientIds,
    );
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
      },
    );
    await this.presence.attachToConversations([data]);
    const memberIds = data.members.map((member) => member.userId);
    this.chatGateway.broadcastConversationUpdated(data, memberIds);
    return { message: CHAT_SUCCESS_MESSAGES.GROUP_UPDATED, data };
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
    const data = await this.proxy.sendChat<BlockView>(CHAT_PATTERNS.BLOCK_USER, {
      actorId: user.id,
      userId: dto.userId,
    });
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
  async listBlocks(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.proxy.sendChat<BlockView[]>(
      CHAT_PATTERNS.LIST_BLOCKS,
      { actorId: user.id },
    );
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
