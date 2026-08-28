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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { extname, resolve } from 'path';
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
  PresenceView,
  SeenResultView,
  SendMessageResult,
  UserProfileView,
} from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { ChatGateway } from './chat.gateway';
import { ConversationCacheService } from './conversation-cache.service';
import {
  AddMembersDto,
  BlockUserDto,
  ChatPageQueryDto,
  CreateGroupChatDto,
  CreatePrivateChatDto,
  DeleteMessageDto,
  EditMessageDto,
  ForwardMessageDto,
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

const UPLOAD_DIR = resolve(process.cwd(), 'uploads');
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
]);
const ALLOWED_UPLOAD_MIMES = new Set([
  ...ALLOWED_IMAGE_MIMES,
  ...ALLOWED_AUDIO_MIMES,
]);
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

type UploadedImage = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

function ensureUploadDir(): void {
  if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

@ChatDocs()
@Controller('chat')
export class ChatController {
  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly presence: PresenceService,
    private readonly chatGateway: ChatGateway,
    private readonly conversationCache: ConversationCacheService,
    private readonly ai: AiService,
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
    return { message: CHAT_SUCCESS_MESSAGES.MESSAGE_SENT, data };
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
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  uploadFile(@UploadedFile() file?: UploadedImage) {
    if (!file) {
      throw new BadRequestAppException('File is required');
    }
    if (!ALLOWED_UPLOAD_MIMES.has(file.mimetype)) {
      throw new BadRequestException(
        'Only jpeg, png, gif, webp images and webm/ogg/mp3/mp4/wav audio are allowed',
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestAppException('File must be 5MB or smaller');
    }

    ensureUploadDir();
    const extension = extname(file.originalname).toLowerCase() || '.bin';
    const filename = `${randomUUID()}${extension}`;
    writeFileSync(resolve(UPLOAD_DIR, filename), file.buffer);

    return {
      message: CHAT_SUCCESS_MESSAGES.FILE_UPLOADED,
      data: {
        url: `/uploads/${filename}`,
        mime: file.mimetype,
        name: file.originalname,
        size: file.size,
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
    await this.conversationCache.invalidate(id);
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
    await this.conversationCache.invalidate(id);
    return { message: CHAT_SUCCESS_MESSAGES.MEMBER_REMOVED, data };
  }

  @Post('conversations/:id/leave')
  @LeaveConversationDocs()
  async leave(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
  ) {
    const data = await this.proxy.sendChat(CHAT_PATTERNS.LEAVE, {
      actorId: user.id,
      conversationId: id,
    });
    await this.conversationCache.invalidate(id);
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
