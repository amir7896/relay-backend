import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import {
  ALLOWED_REACTIONS,
  ConversationMemberRole,
  ConversationType,
  MessageType,
  PresenceStatus,
  RpcErrors,
  buildPaginatedResult,
  getSkipTake,
} from '@app/common';
import type {
  AddMembersPayload,
  BlockUserPayload,
  BlockView,
  ChatAnalyticsView,
  AuditEventView,
  ConversationActorPayload,
  ConversationView,
  CreateGroupChatPayload,
  CreatePollPayload,
  CreatePrivateChatPayload,
  DeleteMessagePayload,
  DeleteMessageResult,
  EditMessagePayload,
  ForwardMessagePayload,
  ListAuditPayload,
  ListBookmarksPayload,
  ListConversationsPayload,
  ListMediaPayload,
  ListMessagesPayload,
  GetMessagePayload,
  LogAuditPayload,
  MarkSeenPayload,
  MessageReactionView,
  MessageReplyView,
  MessageView,
  MuteConversationPayload,
  PinConversationPayload,
  PinMessagePayload,
  PollView,
  ReactMessagePayload,
  RemoveBookmarkPayload,
  RemoveMemberPayload,
  GlobalSearchHitView,
  GlobalSearchMessagesPayload,
  CancelScheduledMessagePayload,
  SaveBookmarkPayload,
  BookmarkView,
  ScheduleMessagePayload,
  ScheduledMessageView,
  SearchMessagesPayload,
  SeenResultView,
  SendMessagePayload,
  SendMessageResult,
  SetDisappearingPayload,
  SetMemberRolePayload,
  UpdateGroupPayload,
  UpdateWorkspacePayload,
  VotePollPayload,
  WorkspaceSettingsView,
} from '@app/contracts';
import { requireOrganizationId, runWithOrganization } from '@app/database';
import { Conversation } from '../database/entities/conversation.entity';
import { ConversationMember } from '../database/entities/conversation-member.entity';
import { Message } from '../database/entities/message.entity';
import { MessageHide } from '../database/entities/message-hide.entity';
import { MessageReaction } from '../database/entities/message-reaction.entity';
import { MessageBookmark } from '../database/entities/message-bookmark.entity';
import { ScheduledMessage } from '../database/entities/scheduled-message.entity';
import { UserBlock } from '../database/entities/user-block.entity';
import { AuditEvent } from '../database/entities/audit-event.entity';
import { WorkspaceSettings } from '../database/entities/workspace-settings.entity';

const MAX_GROUP_MEMBERS = 50;
const DELETE_FOR_EVERYONE_WINDOW_MS = 0; // 0 = no time limit (sender can always delete for everyone)

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const SCHEDULE_MIN_DELAY_MS = 60 * 1000;
const SCHEDULE_MAX_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PENDING_SCHEDULED_PER_CHAT = 20;
const DISAPPEARING_DURATIONS = new Set([
  0, 30, 60, 3600, 86_400, 604_800, 7_776_000,
]);

export function privatePairKey(userA: string, userB: string): string {
  return [userA, userB].sort().join(':');
}

function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    @InjectRepository(ConversationMember)
    private readonly members: Repository<ConversationMember>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    @InjectRepository(MessageHide)
    private readonly messageHides: Repository<MessageHide>,
    @InjectRepository(MessageReaction)
    private readonly messageReactions: Repository<MessageReaction>,
    @InjectRepository(MessageBookmark)
    private readonly messageBookmarks: Repository<MessageBookmark>,
    @InjectRepository(ScheduledMessage)
    private readonly scheduledMessages: Repository<ScheduledMessage>,
    @InjectRepository(UserBlock)
    private readonly userBlocks: Repository<UserBlock>,
    @InjectRepository(AuditEvent)
    private readonly auditEvents: Repository<AuditEvent>,
    @InjectRepository(WorkspaceSettings)
    private readonly workspaceSettings: Repository<WorkspaceSettings>,
  ) {}

  async createPrivate(
    payload: CreatePrivateChatPayload,
  ): Promise<ConversationView> {
    if (payload.actorId === payload.otherUserId) {
      return RpcErrors.badRequest(
        'You cannot start a private chat with yourself',
      );
    }

    const pairKey = privatePairKey(payload.actorId, payload.otherUserId);
    const existing = await this.conversations.findOne({
      where: {
        organizationId: requireOrganizationId(),
        pairKey,
        type: ConversationType.PRIVATE,
      },
      relations: { members: true },
    });
    if (existing) {
      const mentionMeta = await this.unreadMentionMeta(payload.actorId, [
        existing.id,
      ]);
      const mentionId = mentionMeta.get(existing.id) ?? null;
      return this.toConversationView(
        existing,
        payload.actorId,
        await this.unreadCountFor(payload.actorId, existing.id),
        null,
        await this.blockFlagsForConversation(existing, payload.actorId),
        Boolean(mentionId),
        mentionId,
      );
    }

    // Only the blocked party is barred from starting a new private chat.
    if (await this.hasBlock(payload.otherUserId, payload.actorId)) {
      return RpcErrors.forbidden('You cannot start a chat with this user');
    }

    const saved = await this.conversations.manager.transaction(
      async (manager) => {
        const conversation = await manager.save(
          manager.create(Conversation, {
            organizationId: requireOrganizationId(),
            type: ConversationType.PRIVATE,
            name: null,
            createdBy: payload.actorId,
            pairKey,
          }),
        );
        await manager.save([
          manager.create(ConversationMember, {
            conversationId: conversation.id,
            userId: payload.actorId,
            role: ConversationMemberRole.MEMBER,
          }),
          manager.create(ConversationMember, {
            conversationId: conversation.id,
            userId: payload.otherUserId,
            role: ConversationMemberRole.MEMBER,
          }),
        ]);
        return manager.findOneOrFail(Conversation, {
          where: {
            id: conversation.id,
            organizationId: requireOrganizationId(),
          },
          relations: { members: true },
        });
      },
    );

    return this.toConversationView(
      saved,
      payload.actorId,
      0,
      null,
      await this.blockFlagsForConversation(saved, payload.actorId),
    );
  }

  async createGroup(
    payload: CreateGroupChatPayload,
  ): Promise<ConversationView> {
    const name = payload.name.trim();
    if (!name) {
      return RpcErrors.badRequest('Group name is required');
    }

    const uniqueMemberIds = [
      ...new Set(payload.memberIds.filter((id) => id !== payload.actorId)),
    ];
    // Channels may start with only the creator (e.g. #general on workspace create).
    if (uniqueMemberIds.length + 1 > MAX_GROUP_MEMBERS) {
      return RpcErrors.badRequest(
        `A group cannot have more than ${MAX_GROUP_MEMBERS} members`,
      );
    }

    const saved = await this.conversations.manager.transaction(
      async (manager) => {
        const conversation = await manager.save(
          manager.create(Conversation, {
            organizationId: requireOrganizationId(),
            type: ConversationType.GROUP,
            name,
            createdBy: payload.actorId,
            pairKey: null,
          }),
        );
        await manager.save([
          manager.create(ConversationMember, {
            conversationId: conversation.id,
            userId: payload.actorId,
            role: ConversationMemberRole.OWNER,
          }),
          ...uniqueMemberIds.map((userId) =>
            manager.create(ConversationMember, {
              conversationId: conversation.id,
              userId,
              role: ConversationMemberRole.MEMBER,
            }),
          ),
        ]);
        return manager.findOneOrFail(Conversation, {
          where: {
            id: conversation.id,
            organizationId: requireOrganizationId(),
          },
          relations: { members: true },
        });
      },
    );

    return this.toConversationView(saved, payload.actorId);
  }

  async listConversations(payload: ListConversationsPayload) {
    const memberships = await this.members.find({
      where: { userId: payload.actorId, leftAt: IsNull() },
      select: { conversationId: true, pinnedAt: true },
    });
    const conversationIds = memberships.map((item) => item.conversationId);
    if (conversationIds.length === 0) {
      return buildPaginatedResult([], 0, payload.page, payload.limit);
    }

    const pinnedAtByConversation = new Map(
      memberships.map((item) => [item.conversationId, item.pinnedAt] as const),
    );

    const items = await this.conversations.find({
      where: {
        id: In(conversationIds),
        organizationId: requireOrganizationId(),
      },
      relations: { members: true },
    });

    items.sort((a, b) => {
      const aPinned = pinnedAtByConversation.get(a.id) != null ? 1 : 0;
      const bPinned = pinnedAtByConversation.get(b.id) != null ? 1 : 0;
      if (aPinned !== bPinned) {
        return bPinned - aPinned;
      }
      const aTime = a.lastMessageAt?.getTime() ?? a.createdAt.getTime();
      const bTime = b.lastMessageAt?.getTime() ?? b.createdAt.getTime();
      return bTime - aTime;
    });

    const total = items.length;
    const { skip, take } = getSkipTake(payload.page, payload.limit);
    const pageItems = items.slice(skip, skip + take);
    const pageConversationIds = pageItems.map((item) => item.id);
    const unread = await this.unreadCounts(payload.actorId, pageConversationIds);
    const unreadMentions = await this.unreadMentionMeta(
      payload.actorId,
      pageConversationIds,
    );
    const latest = await this.latestMessagesByConversation(
      pageConversationIds,
      payload.actorId,
    );
    const blockFlags = await this.blockFlagsForConversations(
      pageItems,
      payload.actorId,
    );
    return buildPaginatedResult(
      pageItems.map((item) => {
        const mention = unreadMentions.get(item.id);
        return this.toConversationView(
          item,
          payload.actorId,
          unread.get(item.id) ?? 0,
          latest.get(item.id) ?? null,
          blockFlags.get(item.id) ?? { blockedByMe: false, blockedMe: false },
          Boolean(mention),
          mention ?? null,
        );
      }),
      total,
      payload.page,
      payload.limit,
    );
  }

  async getConversation(
    payload: ConversationActorPayload,
  ): Promise<ConversationView> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    const mentionMeta = await this.unreadMentionMeta(payload.actorId, [
      conversation.id,
    ]);
    const mentionId = mentionMeta.get(conversation.id) ?? null;
    return this.toConversationView(
      conversation,
      payload.actorId,
      await this.unreadCountFor(payload.actorId, conversation.id),
      null,
      await this.blockFlagsForConversation(conversation, payload.actorId),
      Boolean(mentionId),
      mentionId,
    );
  }

  async listMessages(payload: ListMessagesPayload) {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    const { skip, take } = getSkipTake(payload.page, payload.limit);
    const [items, total] = await this.messages
      .createQueryBuilder('m')
      .where('m.conversationId = :conversationId', {
        conversationId: payload.conversationId,
      })
      .andWhere('m.organizationId = :organizationId', {
        organizationId: requireOrganizationId(),
      })
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM message_hides mh
          WHERE mh."messageId" = m.id AND mh."userId" = :actorId
        )`,
        { actorId: payload.actorId },
      )
      .andWhere('(m.undelivered = false OR m.senderId = :actorId)', {
        actorId: payload.actorId,
      })
      .orderBy('m.createdAt', 'DESC')
      .skip(skip)
      .take(take)
      .getManyAndCount();

    const replyMap = await this.loadReplyParents(items);
    const reactionsByMessage = await this.loadReactionsByMessageIds(
      items.map((item) => item.id),
    );
    return buildPaginatedResult(
      items.map((item) =>
        this.toMessageView(
          item,
          conversation.members,
          replyMap.get(item.replyToMessageId ?? '') ?? null,
          reactionsByMessage.get(item.id) ?? [],
          payload.actorId,
        ),
      ),
      total,
      payload.page,
      payload.limit,
    );
  }

  async searchMessages(payload: SearchMessagesPayload) {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    const query = payload.query.trim();
    if (!query) {
      return RpcErrors.badRequest('Search query is required');
    }

    const { skip, take } = getSkipTake(payload.page, payload.limit);
    const [items, total] = await this.messages
      .createQueryBuilder('m')
      .where('m.conversationId = :conversationId', {
        conversationId: payload.conversationId,
      })
      .andWhere('m.organizationId = :organizationId', {
        organizationId: requireOrganizationId(),
      })
      .andWhere(`m.body ILIKE :pattern ESCAPE '\\'`, {
        pattern: `%${escapeIlikePattern(query)}%`,
      })
      .andWhere('m.deletedForEveryoneAt IS NULL')
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM message_hides mh
          WHERE mh."messageId" = m.id AND mh."userId" = :actorId
        )`,
        { actorId: payload.actorId },
      )
      .andWhere('(m.undelivered = false OR m.senderId = :actorId)', {
        actorId: payload.actorId,
      })
      .orderBy('m.createdAt', 'DESC')
      .skip(skip)
      .take(take)
      .getManyAndCount();

    const replyMap = await this.loadReplyParents(items);
    const reactionsByMessage = await this.loadReactionsByMessageIds(
      items.map((item) => item.id),
    );
    return buildPaginatedResult(
      items.map((item) =>
        this.toMessageView(
          item,
          conversation.members,
          replyMap.get(item.replyToMessageId ?? '') ?? null,
          reactionsByMessage.get(item.id) ?? [],
          payload.actorId,
        ),
      ),
      total,
      payload.page,
      payload.limit,
    );
  }

  async searchGlobal(payload: GlobalSearchMessagesPayload) {
    const query = payload.query.trim();
    if (!query) {
      return RpcErrors.badRequest('Search query is required');
    }
    if (query.length < 2) {
      return buildPaginatedResult<GlobalSearchHitView>(
        [],
        0,
        payload.page,
        payload.limit,
      );
    }

    const memberships = await this.members.find({
      where: { userId: payload.actorId, leftAt: IsNull() },
      select: { conversationId: true },
    });
    const conversationIds = memberships.map((item) => item.conversationId);
    if (conversationIds.length === 0) {
      return buildPaginatedResult<GlobalSearchHitView>(
        [],
        0,
        payload.page,
        payload.limit,
      );
    }

    const { skip, take } = getSkipTake(payload.page, payload.limit);
    const [items, total] = await this.messages
      .createQueryBuilder('m')
      .where('m.conversationId IN (:...conversationIds)', { conversationIds })
      .andWhere('m.organizationId = :organizationId', {
        organizationId: requireOrganizationId(),
      })
      .andWhere(`m.body ILIKE :pattern ESCAPE '\\'`, {
        pattern: `%${escapeIlikePattern(query)}%`,
      })
      .andWhere('m.deletedForEveryoneAt IS NULL')
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM message_hides mh
          WHERE mh."messageId" = m.id AND mh."userId" = :actorId
        )`,
        { actorId: payload.actorId },
      )
      .andWhere('(m.undelivered = false OR m.senderId = :actorId)', {
        actorId: payload.actorId,
      })
      .orderBy('m.createdAt', 'DESC')
      .skip(skip)
      .take(take)
      .getManyAndCount();

    const uniqueConversationIds = [
      ...new Set(items.map((item) => item.conversationId)),
    ];
    const conversations =
      uniqueConversationIds.length === 0
        ? []
        : await this.conversations.find({
            where: {
              id: In(uniqueConversationIds),
              organizationId: requireOrganizationId(),
            },
            relations: { members: true },
          });
    const conversationById = new Map(
      conversations.map((item) => [item.id, item] as const),
    );

    const replyMap = await this.loadReplyParents(items);
    const reactionsByMessage = await this.loadReactionsByMessageIds(
      items.map((item) => item.id),
    );

    return buildPaginatedResult(
      items.map((item): GlobalSearchHitView => {
        const conversation = conversationById.get(item.conversationId);
        const activeMembers = (conversation?.members ?? []).filter(
          (member) => !member.leftAt,
        );
        return {
          message: this.toMessageView(
            item,
            activeMembers,
            replyMap.get(item.replyToMessageId ?? '') ?? null,
            reactionsByMessage.get(item.id) ?? [],
            payload.actorId,
          ),
          conversation: {
            id: conversation?.id ?? item.conversationId,
            type: conversation?.type ?? ConversationType.PRIVATE,
            name: conversation?.name ?? null,
            members: activeMembers.map((member) => ({
              userId: member.userId,
            })),
          },
        };
      }),
      total,
      payload.page,
      payload.limit,
    );
  }

  async listMedia(payload: ListMediaPayload) {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    const kind = payload.kind ?? 'all';
    const { skip, take } = getSkipTake(payload.page, payload.limit);
    const qb = this.messages
      .createQueryBuilder('m')
      .where('m.conversationId = :conversationId', {
        conversationId: payload.conversationId,
      })
      .andWhere('m.organizationId = :organizationId', {
        organizationId: requireOrganizationId(),
      })
      .andWhere('m.attachmentUrl IS NOT NULL')
      .andWhere("m.attachmentUrl <> ''")
      .andWhere('m.deletedForEveryoneAt IS NULL')
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM message_hides mh
          WHERE mh."messageId" = m.id AND mh."userId" = :actorId
        )`,
        { actorId: payload.actorId },
      )
      .andWhere('(m.undelivered = false OR m.senderId = :actorId)', {
        actorId: payload.actorId,
      });

    if (kind === 'image') {
      qb.andWhere(`(m.type = :imageType OR m.attachmentMime ILIKE 'image/%')`, {
        imageType: MessageType.IMAGE,
      });
    } else if (kind === 'audio') {
      qb.andWhere(
        `(m.type = :audioType OR m.attachmentMime ILIKE 'audio/%' OR m.attachmentMime = 'video/webm')`,
        { audioType: MessageType.AUDIO },
      );
    } else if (kind === 'file') {
      qb.andWhere(
        `(
          m.type = :fileType
          OR (
            m.type NOT IN (:...excludeTypes)
            AND (m.attachmentMime IS NULL OR (
              m.attachmentMime NOT ILIKE 'image/%'
              AND m.attachmentMime NOT ILIKE 'audio/%'
              AND m.attachmentMime <> 'video/webm'
            ))
          )
        )`,
        {
          fileType: MessageType.FILE,
          excludeTypes: [MessageType.IMAGE, MessageType.AUDIO],
        },
      );
    }

    const [items, total] = await qb
      .orderBy('m.createdAt', 'DESC')
      .skip(skip)
      .take(take)
      .getManyAndCount();

    const replyMap = await this.loadReplyParents(items);
    const reactionsByMessage = await this.loadReactionsByMessageIds(
      items.map((item) => item.id),
    );
    return buildPaginatedResult(
      items.map((item) =>
        this.toMessageView(
          item,
          conversation.members,
          replyMap.get(item.replyToMessageId ?? '') ?? null,
          reactionsByMessage.get(item.id) ?? [],
          payload.actorId,
        ),
      ),
      total,
      payload.page,
      payload.limit,
    );
  }

  async getMessage(payload: GetMessagePayload) {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    const message = await this.messages.findOne({
      where: {
        id: payload.messageId,
        conversationId: payload.conversationId,
        organizationId: requireOrganizationId(),
      },
    });
    if (!message) {
      return RpcErrors.notFound('Message not found');
    }
    const hidden = await this.messageHides.findOne({
      where: { messageId: message.id, userId: payload.actorId },
    });
    if (hidden) {
      return RpcErrors.notFound('Message not found');
    }
    const replyMap = await this.loadReplyParents([message]);
    const reactionsByMessage = await this.loadReactionsByMessageIds([
      message.id,
    ]);
    return this.toMessageView(
      message,
      conversation.members,
      replyMap.get(message.replyToMessageId ?? '') ?? null,
      reactionsByMessage.get(message.id) ?? [],
      payload.actorId,
    );
  }

  async sendMessage(payload: SendMessagePayload): Promise<SendMessageResult> {
    const attachmentUrl = payload.attachmentUrl?.trim() || null;
    const rawBody = (payload.body ?? '').trim();
    if (!rawBody && !attachmentUrl) {
      return RpcErrors.badRequest('Message body or attachment is required');
    }

    let type = payload.type ?? MessageType.TEXT;
    if (!Object.values(MessageType).includes(type)) {
      return RpcErrors.badRequest('Unsupported message type');
    }

    // Call history lines are system-only (gateway records after hangup/timeout).
    // Clients must not forge MessageType.CALL via HTTP/WS.
    if (type === MessageType.CALL) {
      if (!payload.systemCall) {
        return RpcErrors.badRequest(
          'Call history messages are system-generated only',
        );
      }
      if (!rawBody) {
        return RpcErrors.badRequest('Call message body is required');
      }
      const conversation = await this.requireMembership(
        payload.conversationId,
        payload.actorId,
      );
      const saved = await this.messages.save(
        this.messages.create({
          organizationId: requireOrganizationId(),
          conversationId: conversation.id,
          senderId: payload.actorId,
          body: rawBody,
          type: MessageType.CALL,
          replyToMessageId: null,
          attachmentUrl: null,
          attachmentMime: null,
          attachmentName: null,
          attachmentSize: null,
          mentions: [],
          linkPreview: null,
          poll: null,
        }),
      );
      conversation.lastMessageAt = saved.createdAt;
      await this.conversations.save(conversation);
      return {
        ...this.toMessageView(
          saved,
          conversation.members,
          null,
          [],
          payload.actorId,
        ),
        recipientIds: this.recipientIds(conversation),
      };
    }

    if (type === MessageType.POLL) {
      return RpcErrors.badRequest('Use the create poll endpoint for polls');
    }

    const attachmentMimeRaw = payload.attachmentMime?.trim() || null;
    const attachmentMime =
      attachmentMimeRaw === 'video/webm' && payload.type === MessageType.AUDIO
        ? 'audio/webm'
        : attachmentMimeRaw;
    if (attachmentUrl) {
      if (attachmentMime?.startsWith('image/')) {
        type = MessageType.IMAGE;
      } else if (
        attachmentMime?.startsWith('audio/') ||
        payload.type === MessageType.AUDIO ||
        attachmentMime === 'video/webm'
      ) {
        type = MessageType.AUDIO;
      } else {
        type = MessageType.FILE;
      }
    }

    const body =
      rawBody ||
      (type === MessageType.IMAGE
        ? '[Image]'
        : type === MessageType.AUDIO
          ? '[Voice note]'
          : type === MessageType.FILE
            ? '[File]'
            : '');

    const mentionUserIds = [
      ...new Set((payload.mentionUserIds ?? []).filter(Boolean)),
    ].filter((userId) => userId !== payload.actorId);

    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );

    const delivery = await this.resolvePrivateDelivery(
      conversation,
      payload.actorId,
    );
    if (delivery.forbidden) {
      return RpcErrors.forbidden('You cannot message this user');
    }

    let replyTo: Message | null = null;
    if (payload.replyToMessageId) {
      replyTo = await this.messages.findOne({
        where: {
          id: payload.replyToMessageId,
          conversationId: conversation.id,
          organizationId: requireOrganizationId(),
        },
      });
      if (!replyTo) {
        return RpcErrors.badRequest(
          'Reply target must be a message in this conversation',
        );
      }
      if (replyTo.deletedForEveryoneAt) {
        return RpcErrors.badRequest(
          'Cannot reply to a message deleted for everyone',
        );
      }
    }

    const activeMemberIds = new Set(
      conversation.members.filter((m) => !m.leftAt).map((m) => m.userId),
    );
    const validMentions = mentionUserIds.filter((userId) =>
      activeMemberIds.has(userId),
    );

    const saved = await this.messages.save(
      this.messages.create({
        organizationId: requireOrganizationId(),
        conversationId: conversation.id,
        senderId: payload.actorId,
        body,
        type,
        replyToMessageId: replyTo?.id ?? null,
        attachmentUrl,
        attachmentMime,
        attachmentName: payload.attachmentName?.trim() || null,
        attachmentSize: payload.attachmentSize ?? null,
        mentions: validMentions,
        linkPreview: payload.linkPreview ?? null,
        undelivered: delivery.undelivered,
        expiresAt:
          conversation.disappearingDurationSeconds > 0
            ? new Date(
                Date.now() + conversation.disappearingDurationSeconds * 1000,
              )
            : null,
      }),
    );
    conversation.lastMessageAt = saved.createdAt;
    await this.conversations.save(conversation);
    await this.recordAudit(
      payload.actorId,
      'message.sent',
      'conversation',
      conversation.id,
      {
        messageId: saved.id,
        type,
        undelivered: delivery.undelivered,
      },
    );
    return {
      ...this.toMessageView(
        saved,
        conversation.members,
        replyTo,
        [],
        payload.actorId,
      ),
      recipientIds: delivery.recipientIds,
      mutedRecipientIds: this.mutedRecipientIds(conversation),
    };
  }

  async editMessage(payload: EditMessagePayload): Promise<SendMessageResult> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    const message = await this.messages.findOne({
      where: {
        id: payload.messageId,
        conversationId: conversation.id,
        organizationId: requireOrganizationId(),
      },
    });
    if (!message) {
      return RpcErrors.notFound('Message');
    }
    if (message.senderId !== payload.actorId) {
      return RpcErrors.forbidden('Only the sender can edit this message');
    }
    if (message.deletedForEveryoneAt) {
      return RpcErrors.badRequest('Cannot edit a deleted message');
    }
    if (message.type === MessageType.POLL || message.poll) {
      return RpcErrors.badRequest('Polls cannot be edited');
    }
    if (message.type === MessageType.CALL) {
      return RpcErrors.badRequest('Call messages cannot be edited');
    }
    const ageMs = Date.now() - message.createdAt.getTime();
    if (ageMs > EDIT_WINDOW_MS) {
      return RpcErrors.badRequest(
        'Messages can only be edited within 15 minutes',
      );
    }

    const body = payload.body.trim();
    if (!body) {
      return RpcErrors.badRequest('Message body is required');
    }

    message.body = body;
    message.editedAt = new Date();
    await this.messages.save(message);

    const replyTo = message.replyToMessageId
      ? await this.messages.findOne({
          where: {
            id: message.replyToMessageId,
            organizationId: requireOrganizationId(),
          },
        })
      : null;
    const reactions = await this.messageReactions.find({
      where: { messageId: message.id },
    });

    return {
      ...this.toMessageView(
        message,
        conversation.members,
        replyTo,
        reactions,
        payload.actorId,
      ),
      recipientIds: this.recipientIds(conversation),
    };
  }

  async reactMessage(payload: ReactMessagePayload): Promise<SendMessageResult> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    if (!(ALLOWED_REACTIONS as readonly string[]).includes(payload.emoji)) {
      return RpcErrors.badRequest('Unsupported reaction');
    }

    const message = await this.messages.findOne({
      where: {
        id: payload.messageId,
        conversationId: conversation.id,
        organizationId: requireOrganizationId(),
      },
    });
    if (!message) {
      return RpcErrors.notFound('Message');
    }
    if (message.deletedForEveryoneAt) {
      return RpcErrors.badRequest('Cannot react to a deleted message');
    }

    const existing = await this.messageReactions.findOne({
      where: {
        messageId: message.id,
        userId: payload.actorId,
        emoji: payload.emoji,
      },
    });
    if (existing) {
      await this.messageReactions.remove(existing);
    } else {
      await this.messageReactions.save(
        this.messageReactions.create({
          messageId: message.id,
          userId: payload.actorId,
          emoji: payload.emoji,
        }),
      );
    }

    const replyTo = message.replyToMessageId
      ? await this.messages.findOne({
          where: {
            id: message.replyToMessageId,
            organizationId: requireOrganizationId(),
          },
        })
      : null;
    const reactions = await this.messageReactions.find({
      where: { messageId: message.id },
    });

    return {
      ...this.toMessageView(
        message,
        conversation.members,
        replyTo,
        reactions,
        payload.actorId,
      ),
      recipientIds: this.recipientIds(conversation),
    };
  }

  async pinMessage(payload: PinMessagePayload): Promise<SendMessageResult> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    const message = await this.messages.findOne({
      where: {
        id: payload.messageId,
        conversationId: conversation.id,
        organizationId: requireOrganizationId(),
      },
    });
    if (!message) {
      return RpcErrors.notFound('Message');
    }
    if (message.deletedForEveryoneAt) {
      return RpcErrors.badRequest('Cannot pin a deleted message');
    }
    if (message.type === MessageType.CALL) {
      return RpcErrors.badRequest('Cannot pin call history messages');
    }

    if (payload.pinned) {
      if (!message.pinnedAt) {
        const currentlyPinned = await this.messages
          .createQueryBuilder('m')
          .where('m.conversationId = :conversationId', {
            conversationId: conversation.id,
          })
          .andWhere('m.organizationId = :organizationId', {
            organizationId: requireOrganizationId(),
          })
          .andWhere('m.pinnedAt IS NOT NULL')
          .andWhere('m.deletedForEveryoneAt IS NULL')
          .getCount();
        if (currentlyPinned >= 3) {
          return RpcErrors.badRequest(
            'You can pin up to 3 messages in a chat. Unpin one first.',
          );
        }
        message.pinnedAt = new Date();
        message.pinnedByUserId = payload.actorId;
        await this.messages.save(message);
      }
    } else if (message.pinnedAt) {
      message.pinnedAt = null;
      message.pinnedByUserId = null;
      await this.messages.save(message);
    }

    const replyTo = message.replyToMessageId
      ? await this.messages.findOne({
          where: {
            id: message.replyToMessageId,
            organizationId: requireOrganizationId(),
          },
        })
      : null;
    const reactions = await this.messageReactions.find({
      where: { messageId: message.id },
    });

    return {
      ...this.toMessageView(
        message,
        conversation.members,
        replyTo,
        reactions,
        payload.actorId,
      ),
      recipientIds: this.recipientIds(conversation),
    };
  }

  async createPoll(payload: CreatePollPayload): Promise<SendMessageResult> {
    const question = payload.question.trim();
    if (question.length < 2) {
      return RpcErrors.badRequest('Poll question is required');
    }
    if (question.length > 240) {
      return RpcErrors.badRequest('Poll question is too long');
    }
    const options = (payload.options ?? [])
      .map((item) => item.trim())
      .filter(Boolean);
    const unique = [...new Set(options.map((item) => item.toLowerCase()))];
    if (options.length < 2 || options.length > 6) {
      return RpcErrors.badRequest('Polls need between 2 and 6 options');
    }
    if (unique.length !== options.length) {
      return RpcErrors.badRequest('Poll options must be unique');
    }
    if (options.some((item) => item.length > 80)) {
      return RpcErrors.badRequest('Poll options must be 80 characters or fewer');
    }

    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    const delivery = await this.resolvePrivateDelivery(
      conversation,
      payload.actorId,
    );
    if (delivery.forbidden) {
      return RpcErrors.forbidden('You cannot message this conversation');
    }

    const saved = await this.messages.save(
      this.messages.create({
        organizationId: requireOrganizationId(),
        conversationId: conversation.id,
        senderId: payload.actorId,
        body: question,
        type: MessageType.POLL,
        replyToMessageId: null,
        attachmentUrl: null,
        attachmentMime: null,
        attachmentName: null,
        attachmentSize: null,
        mentions: [],
        linkPreview: null,
        poll: {
          question,
          options: options.map((text) => ({
            id: randomUUID(),
            text,
            voterIds: [],
          })),
          allowMultiple: Boolean(payload.allowMultiple),
          closed: false,
        },
        undelivered: delivery.undelivered,
        expiresAt:
          !delivery.undelivered && conversation.disappearingDurationSeconds > 0
            ? new Date(
                Date.now() + conversation.disappearingDurationSeconds * 1000,
              )
            : null,
      }),
    );
    conversation.lastMessageAt = saved.createdAt;
    await this.conversations.save(conversation);
    await this.recordAudit(
      payload.actorId,
      'message.poll_created',
      'conversation',
      conversation.id,
      { messageId: saved.id },
    );

    return {
      ...this.toMessageView(
        saved,
        conversation.members,
        null,
        [],
        payload.actorId,
      ),
      recipientIds: delivery.recipientIds,
      mutedRecipientIds: this.mutedRecipientIds(conversation),
    };
  }

  async votePoll(payload: VotePollPayload): Promise<SendMessageResult> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    const message = await this.messages.findOne({
      where: {
        id: payload.messageId,
        conversationId: conversation.id,
        organizationId: requireOrganizationId(),
      },
    });
    if (!message || message.type !== MessageType.POLL || !message.poll) {
      return RpcErrors.notFound('Poll');
    }
    if (message.deletedForEveryoneAt) {
      return RpcErrors.badRequest('Cannot vote on a deleted poll');
    }
    if (message.poll.closed) {
      return RpcErrors.badRequest('This poll is closed');
    }

    const option = message.poll.options.find(
      (item) => item.id === payload.optionId,
    );
    if (!option) {
      return RpcErrors.badRequest('Invalid poll option');
    }

    const alreadyVoted = option.voterIds.includes(payload.actorId);
    const updatedOptions = message.poll.options.map((item) => {
      const withoutActor = item.voterIds.filter((id) => id !== payload.actorId);
      if (item.id === payload.optionId) {
        if (alreadyVoted) {
          return { ...item, voterIds: withoutActor };
        }
        return { ...item, voterIds: [...withoutActor, payload.actorId] };
      }
      if (!message.poll!.allowMultiple) {
        return { ...item, voterIds: withoutActor };
      }
      return item;
    });

    message.poll = {
      ...message.poll,
      options: updatedOptions,
    };
    await this.messages.save(message);

    const reactions = await this.messageReactions.find({
      where: { messageId: message.id },
    });
    const replyTo = message.replyToMessageId
      ? await this.messages.findOne({ where: { id: message.replyToMessageId } })
      : null;

    return {
      ...this.toMessageView(
        message,
        conversation.members,
        replyTo,
        reactions,
        payload.actorId,
      ),
      recipientIds: this.recipientIds(conversation),
      mutedRecipientIds: this.mutedRecipientIds(conversation),
    };
  }

  async saveBookmark(payload: SaveBookmarkPayload): Promise<BookmarkView> {
    const message = await this.messages.findOne({
      where: {
        id: payload.messageId,
        organizationId: requireOrganizationId(),
      },
    });
    if (!message || message.deletedForEveryoneAt) {
      return RpcErrors.notFound('Message');
    }
    await this.requireMembership(message.conversationId, payload.actorId);

    const existing = await this.messageBookmarks.findOne({
      where: { messageId: message.id, userId: payload.actorId },
    });
    const saved =
      existing ??
      (await this.messageBookmarks.save(
        this.messageBookmarks.create({
          organizationId: requireOrganizationId(),
          conversationId: message.conversationId,
          messageId: message.id,
          userId: payload.actorId,
        }),
      ));

    const conversation = await this.conversations.findOne({
      where: {
        id: message.conversationId,
        organizationId: requireOrganizationId(),
      },
      relations: { members: true },
    });
    const reactions = await this.messageReactions.find({
      where: { messageId: message.id },
    });

    return this.toBookmarkView(
      saved,
      message,
      payload.actorId,
      conversation ?? undefined,
      reactions,
    );
  }

  async removeBookmark(
    payload: RemoveBookmarkPayload,
  ): Promise<{ removed: boolean }> {
    const existing = await this.messageBookmarks.findOne({
      where: {
        messageId: payload.messageId,
        userId: payload.actorId,
        organizationId: requireOrganizationId(),
      },
    });
    if (!existing) {
      return { removed: false };
    }
    await this.messageBookmarks.delete({ id: existing.id });
    return { removed: true };
  }

  async listBookmarks(payload: ListBookmarksPayload) {
    const { skip, take } = getSkipTake(payload.page, payload.limit);
    const qb = this.messageBookmarks
      .createQueryBuilder('b')
      .where('b.organizationId = :organizationId', {
        organizationId: requireOrganizationId(),
      })
      .andWhere('b.userId = :actorId', { actorId: payload.actorId })
      .orderBy('b.createdAt', 'DESC')
      .skip(skip)
      .take(take);

    if (payload.conversationId) {
      await this.requireMembership(payload.conversationId, payload.actorId);
      qb.andWhere('b.conversationId = :conversationId', {
        conversationId: payload.conversationId,
      });
    }

    const [rows, total] = await qb.getManyAndCount();
    const messageIds = rows.map((row) => row.messageId);
    const messages =
      messageIds.length === 0
        ? []
        : await this.messages.find({
            where: {
              id: In(messageIds),
              organizationId: requireOrganizationId(),
            },
          });
    const messageById = new Map(messages.map((item) => [item.id, item]));
    const conversationIds = [
      ...new Set(rows.map((row) => row.conversationId)),
    ];
    const conversations =
      conversationIds.length === 0
        ? []
        : await this.conversations.find({
            where: {
              id: In(conversationIds),
              organizationId: requireOrganizationId(),
            },
            relations: { members: true },
          });
    const conversationById = new Map(
      conversations.map((item) => [item.id, item]),
    );
    const reactionMap = await this.loadReactionsByMessageIds(messageIds);

    const items: BookmarkView[] = [];
    for (const row of rows) {
      const message = messageById.get(row.messageId);
      if (!message || message.deletedForEveryoneAt) {
        continue;
      }
      const conversation = conversationById.get(row.conversationId);
      if (!conversation) {
        continue;
      }
      const isMember = (conversation.members ?? []).some(
        (member) => member.userId === payload.actorId && !member.leftAt,
      );
      if (!isMember) {
        continue;
      }
      items.push(
        this.toBookmarkView(
          row,
          message,
          payload.actorId,
          conversation,
          reactionMap.get(message.id) ?? [],
        ),
      );
    }

    return buildPaginatedResult(items, total, payload.page, payload.limit);
  }

  async listPinnedMessages(payload: ConversationActorPayload) {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    const items = await this.messages
      .createQueryBuilder('m')
      .where('m.conversationId = :conversationId', {
        conversationId: payload.conversationId,
      })
      .andWhere('m.organizationId = :organizationId', {
        organizationId: requireOrganizationId(),
      })
      .andWhere('m.pinnedAt IS NOT NULL')
      .andWhere('m.deletedForEveryoneAt IS NULL')
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM message_hides mh
          WHERE mh."messageId" = m.id AND mh."userId" = :actorId
        )`,
        { actorId: payload.actorId },
      )
      .orderBy('m.pinnedAt', 'DESC')
      .take(10)
      .getMany();

    const replyMap = await this.loadReplyParents(items);
    const reactionsByMessage = await this.loadReactionsByMessageIds(
      items.map((item) => item.id),
    );
    return items.map((item) =>
      this.toMessageView(
        item,
        conversation.members,
        replyMap.get(item.replyToMessageId ?? '') ?? null,
        reactionsByMessage.get(item.id) ?? [],
        payload.actorId,
      ),
    );
  }

  async scheduleMessage(
    payload: ScheduleMessagePayload,
  ): Promise<ScheduledMessageView> {
    const attachmentUrl = payload.attachmentUrl?.trim() || null;
    const rawBody = (payload.body ?? '').trim();
    if (!rawBody && !attachmentUrl) {
      return RpcErrors.badRequest('Message body or attachment is required');
    }

    let type = payload.type ?? MessageType.TEXT;
    if (!Object.values(MessageType).includes(type)) {
      return RpcErrors.badRequest('Unsupported message type');
    }
    if (type === MessageType.CALL) {
      return RpcErrors.badRequest('Call messages cannot be scheduled');
    }

    const scheduledFor = new Date(payload.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime())) {
      return RpcErrors.badRequest('Invalid scheduled time');
    }
    const now = Date.now();
    if (scheduledFor.getTime() < now + SCHEDULE_MIN_DELAY_MS) {
      return RpcErrors.badRequest('Schedule at least 1 minute in the future');
    }
    if (scheduledFor.getTime() > now + SCHEDULE_MAX_AHEAD_MS) {
      return RpcErrors.badRequest(
        'Schedule time cannot be more than 30 days ahead',
      );
    }

    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );

    if (conversation.type === ConversationType.PRIVATE) {
      const delivery = await this.resolvePrivateDelivery(
        conversation,
        payload.actorId,
      );
      if (delivery.forbidden) {
        return RpcErrors.forbidden('You cannot message this user');
      }
    }

    const pendingCount = await this.scheduledMessages.count({
      where: {
        organizationId: requireOrganizationId(),
        conversationId: conversation.id,
        senderId: payload.actorId,
        status: 'pending',
      },
    });
    if (pendingCount >= MAX_PENDING_SCHEDULED_PER_CHAT) {
      return RpcErrors.badRequest(
        'You can have up to 20 scheduled messages in a chat',
      );
    }

    const attachmentMimeRaw = payload.attachmentMime?.trim() || null;
    const attachmentMime =
      attachmentMimeRaw === 'video/webm' && payload.type === MessageType.AUDIO
        ? 'audio/webm'
        : attachmentMimeRaw;
    if (attachmentUrl) {
      if (attachmentMime?.startsWith('image/')) {
        type = MessageType.IMAGE;
      } else if (
        attachmentMime?.startsWith('audio/') ||
        payload.type === MessageType.AUDIO ||
        attachmentMime === 'video/webm'
      ) {
        type = MessageType.AUDIO;
      } else {
        type = MessageType.FILE;
      }
    }

    const body =
      rawBody ||
      (type === MessageType.IMAGE
        ? '[Image]'
        : type === MessageType.AUDIO
          ? '[Voice note]'
          : type === MessageType.FILE
            ? '[File]'
            : '');

    if (payload.replyToMessageId) {
      const replyTo = await this.messages.findOne({
        where: {
          id: payload.replyToMessageId,
          conversationId: conversation.id,
          organizationId: requireOrganizationId(),
        },
      });
      if (!replyTo || replyTo.deletedForEveryoneAt) {
        return RpcErrors.badRequest(
          'Reply target must be a message in this conversation',
        );
      }
    }

    const activeMemberIds = new Set(
      conversation.members.filter((m) => !m.leftAt).map((m) => m.userId),
    );
    const validMentions = [
      ...new Set((payload.mentionUserIds ?? []).filter(Boolean)),
    ].filter(
      (userId) => userId !== payload.actorId && activeMemberIds.has(userId),
    );

    const saved = await this.scheduledMessages.save(
      this.scheduledMessages.create({
        organizationId: requireOrganizationId(),
        conversationId: conversation.id,
        senderId: payload.actorId,
        body,
        type,
        replyToMessageId: payload.replyToMessageId ?? null,
        attachmentUrl,
        attachmentMime,
        attachmentName: payload.attachmentName?.trim() || null,
        attachmentSize: payload.attachmentSize ?? null,
        mentions: validMentions,
        linkPreview: payload.linkPreview ?? null,
        scheduledFor,
        status: 'pending',
      }),
    );

    await this.recordAudit(
      payload.actorId,
      'message.scheduled',
      'conversation',
      conversation.id,
      { scheduledMessageId: saved.id, scheduledFor: saved.scheduledFor },
    );

    return this.toScheduledMessageView(saved);
  }

  async listScheduledMessages(payload: ConversationActorPayload) {
    await this.requireMembership(payload.conversationId, payload.actorId);
    const items = await this.scheduledMessages.find({
      where: {
        organizationId: requireOrganizationId(),
        conversationId: payload.conversationId,
        senderId: payload.actorId,
        status: 'pending',
      },
      order: { scheduledFor: 'ASC' },
      take: 50,
    });
    return items.map((item) => this.toScheduledMessageView(item));
  }

  async cancelScheduledMessage(payload: CancelScheduledMessagePayload) {
    await this.requireMembership(payload.conversationId, payload.actorId);
    const item = await this.scheduledMessages.findOne({
      where: {
        id: payload.scheduledMessageId,
        organizationId: requireOrganizationId(),
        conversationId: payload.conversationId,
        senderId: payload.actorId,
      },
    });
    if (!item) {
      return RpcErrors.notFound('Scheduled message');
    }
    if (item.status !== 'pending') {
      return RpcErrors.badRequest(
        'Only pending scheduled messages can be cancelled',
      );
    }
    item.status = 'cancelled';
    item.cancelledAt = new Date();
    await this.scheduledMessages.save(item);
    return this.toScheduledMessageView(item);
  }

  async dispatchDueScheduled(): Promise<SendMessageResult[]> {
    const due = await this.scheduledMessages.find({
      where: {
        status: 'pending',
        scheduledFor: LessThanOrEqual(new Date()),
      },
      order: { scheduledFor: 'ASC' },
      take: 25,
    });

    const delivered: SendMessageResult[] = [];
    for (const row of due) {
      const claimed = await this.scheduledMessages.update(
        {
          id: row.id,
          organizationId: row.organizationId,
          status: 'pending',
        },
        { status: 'sending' },
      );
      if (!claimed.affected) {
        continue;
      }

      try {
        const result = await runWithOrganization(row.organizationId, () =>
          this.sendMessage({
            actorId: row.senderId,
            conversationId: row.conversationId,
            body: row.body,
            type: row.type,
            replyToMessageId: row.replyToMessageId ?? undefined,
            attachmentUrl: row.attachmentUrl ?? undefined,
            attachmentMime: row.attachmentMime ?? undefined,
            attachmentName: row.attachmentName ?? undefined,
            attachmentSize: row.attachmentSize ?? undefined,
            mentionUserIds: row.mentions ?? [],
            linkPreview: row.linkPreview,
          }),
        );
        row.status = 'sent';
        row.sentMessageId = result.id;
        row.error = null;
        await this.scheduledMessages.save(row);
        delivered.push(result);
      } catch (error) {
        row.status = 'failed';
        row.error =
          error instanceof Error ? error.message.slice(0, 500) : 'Send failed';
        await this.scheduledMessages.save(row);
      }
    }
    return delivered;
  }

  async forwardMessage(
    payload: ForwardMessagePayload,
  ): Promise<SendMessageResult> {
    const fromConversation = await this.requireMembership(
      payload.fromConversationId,
      payload.actorId,
    );
    const toConversation = await this.requireMembership(
      payload.toConversationId,
      payload.actorId,
    );

    const source = await this.messages.findOne({
      where: {
        id: payload.messageId,
        conversationId: fromConversation.id,
        organizationId: requireOrganizationId(),
      },
    });
    if (!source || source.deletedForEveryoneAt) {
      return RpcErrors.notFound('Message');
    }

    if (toConversation.type === ConversationType.PRIVATE) {
      const delivery = await this.resolvePrivateDelivery(
        toConversation,
        payload.actorId,
      );
      if (delivery.forbidden) {
        return RpcErrors.forbidden('You cannot message this user');
      }
      const saved = await this.messages.save(
        this.messages.create({
          organizationId: requireOrganizationId(),
          conversationId: toConversation.id,
          senderId: payload.actorId,
          body: source.body,
          type: source.type,
          attachmentUrl: source.attachmentUrl,
          attachmentMime: source.attachmentMime,
          attachmentName: source.attachmentName,
          attachmentSize: source.attachmentSize,
          forwardedFromMessageId: source.id,
          undelivered: delivery.undelivered,
          expiresAt:
            toConversation.disappearingDurationSeconds > 0 &&
            source.type !== MessageType.CALL
              ? new Date(
                  Date.now() +
                    toConversation.disappearingDurationSeconds * 1000,
                )
              : null,
        }),
      );
      toConversation.lastMessageAt = saved.createdAt;
      await this.conversations.save(toConversation);
      return {
        ...this.toMessageView(
          saved,
          toConversation.members,
          null,
          [],
          payload.actorId,
        ),
        recipientIds: delivery.recipientIds,
      };
    }

    const saved = await this.messages.save(
      this.messages.create({
        organizationId: requireOrganizationId(),
        conversationId: toConversation.id,
        senderId: payload.actorId,
        body: source.body,
        type: source.type,
        attachmentUrl: source.attachmentUrl,
        attachmentMime: source.attachmentMime,
        attachmentName: source.attachmentName,
        attachmentSize: source.attachmentSize,
        forwardedFromMessageId: source.id,
        expiresAt:
          toConversation.disappearingDurationSeconds > 0 &&
          source.type !== MessageType.CALL
            ? new Date(
                Date.now() + toConversation.disappearingDurationSeconds * 1000,
              )
            : null,
      }),
    );
    toConversation.lastMessageAt = saved.createdAt;
    await this.conversations.save(toConversation);

    return {
      ...this.toMessageView(
        saved,
        toConversation.members,
        null,
        [],
        payload.actorId,
      ),
      recipientIds: this.recipientIds(toConversation),
    };
  }

  async pinConversation(
    payload: PinConversationPayload,
  ): Promise<ConversationView> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    const membership = conversation.members.find(
      (member) => member.userId === payload.actorId && !member.leftAt,
    );
    if (!membership) {
      return RpcErrors.notFound('Membership');
    }

    membership.pinnedAt = payload.pinned ? new Date() : null;
    await this.members.save(membership);
    return this.getConversation(payload);
  }

  async markSeen(payload: MarkSeenPayload): Promise<SeenResultView> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    const membership = conversation.members.find(
      (member) => member.userId === payload.actorId && !member.leftAt,
    );
    if (!membership) {
      return RpcErrors.notFound('Membership');
    }

    let messageId: string | null = null;
    // Always advance the read cursor to "now" so every message already in the
    // thread is treated as read (WhatsApp-style while the chat is open).
    const nextReadAt = new Date();
    if (payload.messageId) {
      const message = await this.messages.findOne({
        where: {
          id: payload.messageId,
          conversationId: conversation.id,
          organizationId: requireOrganizationId(),
        },
      });
      if (!message) {
        return RpcErrors.notFound('Message');
      }
      messageId = message.id;
    }

    if (!membership.lastReadAt || nextReadAt > membership.lastReadAt) {
      membership.lastReadAt = nextReadAt;
      await this.members.save(membership);
    }

    return {
      conversationId: conversation.id,
      userId: payload.actorId,
      lastReadAt: membership.lastReadAt.toISOString(),
      messageId,
      recipientIds: this.recipientIds(conversation),
    };
  }

  async muteConversation(
    payload: MuteConversationPayload,
  ): Promise<ConversationView> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    const membership = conversation.members.find(
      (member) => member.userId === payload.actorId && !member.leftAt,
    );
    if (!membership) {
      return RpcErrors.notFound('Membership');
    }

    membership.mutedAt = payload.muted ? new Date() : null;
    await this.members.save(membership);
    return this.getConversation(payload);
  }

  async setDisappearingMessages(
    payload: SetDisappearingPayload,
  ): Promise<ConversationView> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    if (!DISAPPEARING_DURATIONS.has(payload.durationSeconds)) {
      return RpcErrors.badRequest('Unsupported disappearing duration');
    }

    if (conversation.type === ConversationType.GROUP) {
      const actor = conversation.members.find(
        (member) => member.userId === payload.actorId && !member.leftAt,
      );
      if (
        !actor ||
        (actor.role !== ConversationMemberRole.OWNER &&
          actor.role !== ConversationMemberRole.ADMIN)
      ) {
        return RpcErrors.forbidden(
          'Only group owners and admins can change disappearing messages',
        );
      }
    }

    conversation.disappearingDurationSeconds = payload.durationSeconds;
    await this.conversations.save(conversation);
    await this.recordAudit(
      payload.actorId,
      'conversation.disappearing_updated',
      'conversation',
      conversation.id,
      { durationSeconds: payload.durationSeconds },
    );
    return this.getConversation(payload);
  }

  async expireDueMessages(): Promise<DeleteMessageResult[]> {
    const due = await this.messages.find({
      where: {
        expiresAt: LessThanOrEqual(new Date()),
        deletedForEveryoneAt: IsNull(),
      },
      order: { expiresAt: 'ASC' },
      take: 40,
    });

    const expired: DeleteMessageResult[] = [];
    for (const message of due) {
      const result = await runWithOrganization(
        message.organizationId,
        async () => {
          const conversation = await this.conversations.findOne({
            where: {
              id: message.conversationId,
              organizationId: message.organizationId,
            },
            relations: { members: true },
          });
          if (!conversation) {
            message.expiresAt = null;
            await this.messages.save(message);
            return null;
          }

          const removedAttachmentUrl = message.attachmentUrl;
          message.deletedForEveryoneAt = new Date();
          message.attachmentUrl = null;
          message.attachmentMime = null;
          message.attachmentName = null;
          message.attachmentSize = null;
          message.pinnedAt = null;
          message.pinnedByUserId = null;
          message.expiresAt = null;
          await this.messages.save(message);

          const replyTo = message.replyToMessageId
            ? await this.messages.findOne({
                where: {
                  id: message.replyToMessageId,
                  organizationId: message.organizationId,
                },
              })
            : null;
          return {
            message: this.toMessageView(
              message,
              conversation.members,
              replyTo,
              [],
              message.senderId,
            ),
            forEveryone: true,
            recipientIds: this.recipientIds(conversation),
            removedAttachmentUrl,
          } satisfies DeleteMessageResult;
        },
      );
      if (result) {
        expired.push(result);
      }
    }
    return expired;
  }

  async deleteMessage(
    payload: DeleteMessagePayload,
  ): Promise<DeleteMessageResult> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    const message = await this.messages.findOne({
      where: {
        id: payload.messageId,
        conversationId: conversation.id,
        organizationId: requireOrganizationId(),
      },
    });
    if (!message) {
      return RpcErrors.notFound('Message');
    }

    if (payload.forEveryone) {
      if (message.senderId !== payload.actorId) {
        return RpcErrors.forbidden(
          'Only the sender can delete a message for everyone',
        );
      }
      if (message.deletedForEveryoneAt) {
        const replyTo = message.replyToMessageId
          ? await this.messages.findOne({
              where: {
                id: message.replyToMessageId,
                organizationId: requireOrganizationId(),
              },
            })
          : null;
        const reactions = await this.messageReactions.find({
          where: { messageId: message.id },
        });
        return {
          message: this.toMessageView(
            message,
            conversation.members,
            replyTo,
            reactions,
            payload.actorId,
          ),
          forEveryone: true,
          recipientIds: this.recipientIds(conversation),
        };
      }
      const ageMs = Date.now() - message.createdAt.getTime();
      if (
        DELETE_FOR_EVERYONE_WINDOW_MS > 0 &&
        ageMs > DELETE_FOR_EVERYONE_WINDOW_MS
      ) {
        return RpcErrors.badRequest(
          'Messages can only be deleted for everyone within the allowed time window',
        );
      }
      const removedAttachmentUrl = message.attachmentUrl;
      message.deletedForEveryoneAt = new Date();
      // Clear attachment metadata so the media URL is no longer served
      message.attachmentUrl = null;
      message.attachmentMime = null;
      message.attachmentName = null;
      message.attachmentSize = null;
      message.pinnedAt = null;
      message.pinnedByUserId = null;
      await this.messages.save(message);
      const replyTo = message.replyToMessageId
        ? await this.messages.findOne({
            where: {
              id: message.replyToMessageId,
              organizationId: requireOrganizationId(),
            },
          })
        : null;
      const reactions = await this.messageReactions.find({
        where: { messageId: message.id },
      });
      return {
        message: this.toMessageView(
          message,
          conversation.members,
          replyTo,
          reactions,
          payload.actorId,
        ),
        forEveryone: true,
        recipientIds: this.recipientIds(conversation),
        removedAttachmentUrl,
      };
    }

    const existingHide = await this.messageHides.findOne({
      where: { messageId: message.id, userId: payload.actorId },
    });
    if (!existingHide) {
      await this.messageHides.save(
        this.messageHides.create({
          messageId: message.id,
          userId: payload.actorId,
        }),
      );
    }

    const replyTo = message.replyToMessageId
      ? await this.messages.findOne({
          where: {
            id: message.replyToMessageId,
            organizationId: requireOrganizationId(),
          },
        })
      : null;
    const reactions = await this.messageReactions.find({
      where: { messageId: message.id },
    });
    return {
      message: this.toMessageView(
        message,
        conversation.members,
        replyTo,
        reactions,
        payload.actorId,
      ),
      forEveryone: false,
      recipientIds: [payload.actorId],
    };
  }

  async ensureGeneralMembership(payload: {
    userId: string;
  }): Promise<{ joined: boolean; conversationId: string | null }> {
    const organizationId = requireOrganizationId();
    const candidates = await this.conversations.find({
      where: {
        organizationId,
        type: ConversationType.GROUP,
        deletedAt: IsNull(),
      },
      relations: { members: true },
    });
    const general = candidates.find((item) => {
      const name = (item.name ?? '').trim().toLowerCase().replace(/^#/, '');
      return name === 'general';
    });
    if (!general) {
      return { joined: false, conversationId: null };
    }

    const existing = general.members.find(
      (member) => member.userId === payload.userId,
    );
    if (existing && !existing.leftAt) {
      return { joined: true, conversationId: general.id };
    }
    if (existing?.leftAt) {
      existing.leftAt = null;
      existing.role = ConversationMemberRole.MEMBER;
      await this.members.save(existing);
      return { joined: true, conversationId: general.id };
    }

    await this.members.save(
      this.members.create({
        conversationId: general.id,
        userId: payload.userId,
        role: ConversationMemberRole.MEMBER,
      }),
    );
    return { joined: true, conversationId: general.id };
  }

  async addMembers(payload: AddMembersPayload): Promise<ConversationView> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    this.assertGroupAdmin(conversation, payload.actorId);

    const uniqueIds = [
      ...new Set(payload.memberIds.filter((id) => id !== payload.actorId)),
    ];
    if (uniqueIds.length === 0) {
      return RpcErrors.badRequest('At least one member id is required');
    }

    const activeCount = conversation.members.filter(
      (member) => !member.leftAt,
    ).length;
    if (activeCount + uniqueIds.length > MAX_GROUP_MEMBERS) {
      return RpcErrors.badRequest(
        `A group cannot have more than ${MAX_GROUP_MEMBERS} members`,
      );
    }

    for (const userId of uniqueIds) {
      const existing = conversation.members.find(
        (member) => member.userId === userId,
      );
      if (existing && !existing.leftAt) {
        continue;
      }
      if (existing?.leftAt) {
        existing.leftAt = null;
        existing.role = ConversationMemberRole.MEMBER;
        await this.members.save(existing);
        continue;
      }
      await this.members.save(
        this.members.create({
          conversationId: conversation.id,
          userId,
          role: ConversationMemberRole.MEMBER,
        }),
      );
    }

    return this.getConversation(payload);
  }

  async removeMember(payload: RemoveMemberPayload): Promise<ConversationView> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    this.assertGroupAdmin(conversation, payload.actorId);

    if (payload.memberId === payload.actorId) {
      return RpcErrors.badRequest('Use leave to exit a group yourself');
    }

    const target = conversation.members.find(
      (member) => member.userId === payload.memberId && !member.leftAt,
    );
    if (!target) {
      return RpcErrors.notFound('Member');
    }
    if (target.role === ConversationMemberRole.OWNER) {
      return RpcErrors.forbidden('The group owner cannot be removed');
    }

    target.leftAt = new Date();
    await this.members.save(target);
    return this.getConversation(payload);
  }

  async setMemberRole(
    payload: SetMemberRolePayload,
  ): Promise<ConversationView> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    if (conversation.type !== ConversationType.GROUP) {
      return RpcErrors.badRequest(
        'Only group conversations support this action',
      );
    }

    const actor = conversation.members.find(
      (member) => member.userId === payload.actorId && !member.leftAt,
    );
    if (!actor || actor.role !== ConversationMemberRole.OWNER) {
      return RpcErrors.forbidden(
        'Only the group owner can change member roles',
      );
    }

    if (
      payload.role !== ConversationMemberRole.ADMIN &&
      payload.role !== ConversationMemberRole.MEMBER
    ) {
      return RpcErrors.badRequest('Role must be ADMIN or MEMBER');
    }

    const target = conversation.members.find(
      (member) => member.userId === payload.memberId && !member.leftAt,
    );
    if (!target) {
      return RpcErrors.notFound('Member');
    }
    if (target.role === ConversationMemberRole.OWNER) {
      return RpcErrors.forbidden('The group owner role cannot be changed');
    }
    if (target.userId === payload.actorId) {
      return RpcErrors.badRequest('Cannot change your own role');
    }

    target.role = payload.role;
    await this.members.save(target);
    return this.getConversation(payload);
  }

  async leave(payload: ConversationActorPayload): Promise<{ left: boolean }> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    if (conversation.type === ConversationType.PRIVATE) {
      return RpcErrors.badRequest(
        'Private chats cannot be left. Delete is not supported.',
      );
    }

    const membership = conversation.members.find(
      (member) => member.userId === payload.actorId && !member.leftAt,
    );
    if (!membership) {
      return RpcErrors.notFound('Membership');
    }
    if (membership.role === ConversationMemberRole.OWNER) {
      const remaining = conversation.members
        .filter((member) => !member.leftAt && member.userId !== payload.actorId)
        .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
      if (remaining[0]) {
        remaining[0].role = ConversationMemberRole.OWNER;
        await this.members.save(remaining[0]);
      }
    }

    membership.leftAt = new Date();
    await this.members.save(membership);
    return { left: true };
  }

  async updateGroup(payload: UpdateGroupPayload): Promise<ConversationView> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    this.assertGroupAdmin(conversation, payload.actorId);
    const name = payload.name.trim();
    if (!name) {
      return RpcErrors.badRequest('Group name is required');
    }
    conversation.name = name;
    await this.conversations.save(conversation);
    return this.getConversation(payload);
  }

  async deleteGroup(
    payload: ConversationActorPayload,
  ): Promise<{ deleted: boolean; recipientIds: string[] }> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    if (conversation.type !== ConversationType.GROUP) {
      return RpcErrors.badRequest('Only group chats can be deleted');
    }
    if (conversation.createdBy !== payload.actorId) {
      return RpcErrors.forbidden(
        'Only the group creator can delete this group',
      );
    }

    const recipientIds = conversation.members.map((member) => member.userId);
    const now = new Date();
    for (const member of conversation.members) {
      if (!member.leftAt) {
        member.leftAt = now;
      }
    }
    await this.members.save(conversation.members);
    await this.conversations.softDelete({
      id: conversation.id,
      organizationId: requireOrganizationId(),
    });
    return { deleted: true, recipientIds };
  }

  async blockUser(payload: BlockUserPayload): Promise<BlockView> {
    if (payload.actorId === payload.userId) {
      return RpcErrors.badRequest('You cannot block yourself');
    }

    let block = await this.userBlocks.findOne({
      where: {
        organizationId: requireOrganizationId(),
        blockerId: payload.actorId,
        blockedId: payload.userId,
      },
    });
    if (!block) {
      block = await this.userBlocks.save(
        this.userBlocks.create({
          organizationId: requireOrganizationId(),
          blockerId: payload.actorId,
          blockedId: payload.userId,
        }),
      );
    }

    return {
      userId: block.blockedId,
      createdAt: block.createdAt.toISOString(),
    };
  }

  async unblockUser(
    payload: BlockUserPayload,
  ): Promise<{ unblocked: boolean }> {
    const result = await this.userBlocks.delete({
      organizationId: requireOrganizationId(),
      blockerId: payload.actorId,
      blockedId: payload.userId,
    });
    return { unblocked: (result.affected ?? 0) > 0 };
  }

  async listBlocks(payload: { actorId: string }): Promise<BlockView[]> {
    const blocks = await this.userBlocks.find({
      where: {
        organizationId: requireOrganizationId(),
        blockerId: payload.actorId,
      },
      order: { createdAt: 'DESC' },
    });
    return blocks.map((block) => ({
      userId: block.blockedId,
      createdAt: block.createdAt.toISOString(),
    }));
  }

  /** Validates membership + blocks before WebRTC signaling starts (private or group). */
  async prepareVoiceCall(payload: ConversationActorPayload): Promise<{
    conversationId: string;
    kind: 'private' | 'group';
    peerIds: string[];
    memberIds: string[];
  }> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    const activeMembers = conversation.members.filter(
      (member) => !member.leftAt,
    );
    if (activeMembers.length < 2) {
      return RpcErrors.badRequest('Not enough participants for a call');
    }

    const MAX_GROUP_CALL = 8;
    if (
      conversation.type === ConversationType.GROUP &&
      activeMembers.length > MAX_GROUP_CALL
    ) {
      return RpcErrors.badRequest(
        `Group calls support up to ${MAX_GROUP_CALL} participants`,
      );
    }

    const memberIds = activeMembers.map((member) => member.userId);
    const peerIds: string[] = [];

    for (const member of activeMembers) {
      if (member.userId === payload.actorId) {
        continue;
      }
      if (await this.isBlockedEitherWay(payload.actorId, member.userId)) {
        if (conversation.type === ConversationType.PRIVATE) {
          return RpcErrors.forbidden('You cannot call this user');
        }
        continue;
      }
      peerIds.push(member.userId);
    }

    if (peerIds.length === 0) {
      return RpcErrors.badRequest('No participants available to call');
    }

    return {
      conversationId: conversation.id,
      kind: conversation.type === ConversationType.GROUP ? 'group' : 'private',
      peerIds,
      // Include every active member so lobby / active-call auth matches the group
      memberIds,
    };
  }

  async getAnalytics(): Promise<ChatAnalyticsView> {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 6);
    weekAgo.setHours(0, 0, 0, 0);

    const [totalConversations, totalMessages, messagesToday, messagesThisWeek] =
      await Promise.all([
        this.conversations.count({
          where: {
            organizationId: requireOrganizationId(),
            deletedAt: IsNull(),
          },
        }),
        this.messages.count({
          where: {
            organizationId: requireOrganizationId(),
            deletedAt: IsNull(),
          },
        }),
        this.messages
          .createQueryBuilder('m')
          .where('m.createdAt >= :startOfDay', { startOfDay })
          .andWhere('m.organizationId = :organizationId', {
            organizationId: requireOrganizationId(),
          })
          .andWhere('m.deletedAt IS NULL')
          .getCount(),
        this.messages
          .createQueryBuilder('m')
          .where('m.createdAt >= :weekAgo', { weekAgo })
          .andWhere('m.organizationId = :organizationId', {
            organizationId: requireOrganizationId(),
          })
          .andWhere('m.deletedAt IS NULL')
          .getCount(),
      ]);

    const activeConversationsToday = Number(
      (
        await this.messages
          .createQueryBuilder('m')
          .select('COUNT(DISTINCT m.conversationId)', 'count')
          .where('m.createdAt >= :startOfDay', { startOfDay })
          .andWhere('m.organizationId = :organizationId', {
            organizationId: requireOrganizationId(),
          })
          .andWhere('m.deletedAt IS NULL')
          .getRawOne<{ count: string }>()
      )?.count ?? 0,
    );

    const dayRows = await this.messages
      .createQueryBuilder('m')
      .select(`to_char(m.createdAt, 'YYYY-MM-DD')`, 'date')
      .addSelect('COUNT(*)', 'count')
      .where('m.createdAt >= :weekAgo', { weekAgo })
      .andWhere('m.organizationId = :organizationId', {
        organizationId: requireOrganizationId(),
      })
      .andWhere('m.deletedAt IS NULL')
      .groupBy(`to_char(m.createdAt, 'YYYY-MM-DD')`)
      .orderBy('date', 'ASC')
      .getRawMany<{ date: string; count: string }>();

    const messagesByDay: { date: string; count: number }[] = [];
    for (let i = 0; i < 7; i += 1) {
      const day = new Date(weekAgo);
      day.setDate(weekAgo.getDate() + i);
      const key = day.toISOString().slice(0, 10);
      const row = dayRows.find((item) => item.date === key);
      messagesByDay.push({ date: key, count: Number(row?.count ?? 0) });
    }

    const topRows = await this.messages
      .createQueryBuilder('m')
      .innerJoin('m.conversation', 'c')
      .select('m.conversationId', 'conversationId')
      .addSelect('c.name', 'name')
      .addSelect('c.type', 'type')
      .addSelect('COUNT(*)', 'messageCount')
      .where('m.deletedAt IS NULL')
      .andWhere('m.organizationId = :organizationId', {
        organizationId: requireOrganizationId(),
      })
      .andWhere('c.organizationId = :organizationId', {
        organizationId: requireOrganizationId(),
      })
      .groupBy('m.conversationId')
      .addGroupBy('c.name')
      .addGroupBy('c.type')
      .orderBy('"messageCount"', 'DESC')
      .limit(5)
      .getRawMany<{
        conversationId: string;
        name: string | null;
        type: string;
        messageCount: string;
      }>();

    return {
      totalConversations,
      totalMessages,
      messagesToday,
      messagesThisWeek,
      activeConversationsToday,
      messagesByDay,
      topConversations: topRows.map((row) => ({
        conversationId: row.conversationId,
        name: row.name,
        type: row.type,
        messageCount: Number(row.messageCount),
      })),
    };
  }

  async listAuditEvents(payload: ListAuditPayload) {
    const { skip, take } = getSkipTake(payload.page, payload.limit);
    const [items, total] = await this.auditEvents.findAndCount({
      where: { organizationId: requireOrganizationId() },
      order: { createdAt: 'DESC' },
      skip,
      take,
    });
    return buildPaginatedResult(
      items.map((item) => this.toAuditView(item)),
      total,
      payload.page,
      payload.limit,
    );
  }

  async logAudit(payload: LogAuditPayload): Promise<AuditEventView> {
    const saved = await this.auditEvents.save(
      this.auditEvents.create({
        organizationId: requireOrganizationId(),
        actorId: payload.actorId,
        action: payload.action,
        targetType: payload.targetType ?? null,
        targetId: payload.targetId ?? null,
        meta: payload.meta ?? {},
      }),
    );
    return this.toAuditView(saved);
  }

  async getWorkspaceSettings(): Promise<WorkspaceSettingsView> {
    const organizationId = requireOrganizationId();
    let settings = await this.workspaceSettings.findOne({
      where: { organizationId },
    });
    if (!settings) {
      settings = await this.workspaceSettings.save(
        this.workspaceSettings.create({
          organizationId,
          appName: 'Relay',
          tagline: 'Private team messenger',
          primaryColor: '#2563eb',
        }),
      );
    }
    return this.toWorkspaceView(settings);
  }

  async updateWorkspaceSettings(
    payload: UpdateWorkspacePayload,
  ): Promise<WorkspaceSettingsView> {
    const organizationId = requireOrganizationId();
    let settings = await this.workspaceSettings.findOne({
      where: { organizationId },
    });
    if (!settings) {
      settings = this.workspaceSettings.create({ organizationId });
    }
    if (payload.appName?.trim()) {
      settings.appName = payload.appName.trim().slice(0, 80);
    }
    if (payload.tagline?.trim()) {
      settings.tagline = payload.tagline.trim().slice(0, 200);
    }
    if (payload.primaryColor?.trim()) {
      settings.primaryColor = payload.primaryColor.trim().slice(0, 16);
    }
    if (payload.logoUrl !== undefined) {
      settings.logoUrl = payload.logoUrl?.trim() || null;
    }
    const saved = await this.workspaceSettings.save(settings);
    await this.recordAudit(
      payload.actorId,
      'workspace.updated',
      'workspace',
      organizationId,
    );
    return this.toWorkspaceView(saved);
  }

  async purgeOrganization(organizationId: string): Promise<{ deleted: boolean }> {
    const orgId = organizationId.trim();
    if (!orgId) {
      return RpcErrors.badRequest('organizationId is required');
    }

    await this.scheduledMessages.delete({ organizationId: orgId });
    await this.auditEvents.delete({ organizationId: orgId });
    await this.userBlocks.delete({ organizationId: orgId });
    await this.workspaceSettings.delete({ organizationId: orgId });

    // Hard-delete messages first so soft-deleted rows are also removed;
    // reactions/hides cascade from messages.
    await this.messages
      .createQueryBuilder()
      .delete()
      .from(Message)
      .where('"organizationId" = :orgId', { orgId })
      .execute();

    // Conversation members cascade from conversations.
    await this.conversations
      .createQueryBuilder()
      .delete()
      .from(Conversation)
      .where('"organizationId" = :orgId', { orgId })
      .execute();

    return { deleted: true };
  }

  private async recordAudit(
    actorId: string,
    action: string,
    targetType?: string,
    targetId?: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditEvents.save(
      this.auditEvents.create({
        organizationId: requireOrganizationId(),
        actorId,
        action,
        targetType: targetType ?? null,
        targetId: targetId ?? null,
        meta: meta ?? {},
      }),
    );
  }

  private toAuditView(item: AuditEvent): AuditEventView {
    return {
      id: item.id,
      actorId: item.actorId,
      action: item.action,
      targetType: item.targetType,
      targetId: item.targetId,
      meta: item.meta ?? {},
      createdAt: item.createdAt.toISOString(),
    };
  }

  private toWorkspaceView(item: WorkspaceSettings): WorkspaceSettingsView {
    return {
      appName: item.appName,
      tagline: item.tagline,
      primaryColor: item.primaryColor,
      logoUrl: item.logoUrl,
    };
  }

  private async isBlockedEitherWay(
    userA: string,
    userB: string,
  ): Promise<boolean> {
    const count = await this.userBlocks.count({
      where: [
        {
          organizationId: requireOrganizationId(),
          blockerId: userA,
          blockedId: userB,
        },
        {
          organizationId: requireOrganizationId(),
          blockerId: userB,
          blockedId: userA,
        },
      ],
    });
    return count > 0;
  }

  private async hasBlock(
    blockerId: string,
    blockedId: string,
  ): Promise<boolean> {
    const count = await this.userBlocks.count({
      where: {
        organizationId: requireOrganizationId(),
        blockerId,
        blockedId,
      },
    });
    return count > 0;
  }

  private async resolvePrivateDelivery(
    conversation: Conversation,
    actorId: string,
  ): Promise<{
    forbidden: boolean;
    undelivered: boolean;
    recipientIds: string[];
  }> {
    if (conversation.type !== ConversationType.PRIVATE) {
      return {
        forbidden: false,
        undelivered: false,
        recipientIds: this.recipientIds(conversation),
      };
    }
    const other = (conversation.members ?? []).find(
      (member) => member.userId !== actorId && !member.leftAt,
    );
    if (!other) {
      return {
        forbidden: false,
        undelivered: false,
        recipientIds: this.recipientIds(conversation),
      };
    }
    const [blockedByMe, blockedMe] = await Promise.all([
      this.hasBlock(actorId, other.userId),
      this.hasBlock(other.userId, actorId),
    ]);
    if (blockedMe) {
      return { forbidden: true, undelivered: false, recipientIds: [] };
    }
    if (blockedByMe) {
      return {
        forbidden: false,
        undelivered: true,
        recipientIds: [actorId],
      };
    }
    return {
      forbidden: false,
      undelivered: false,
      recipientIds: this.recipientIds(conversation),
    };
  }

  private async blockFlagsForConversation(
    conversation: Conversation,
    actorId: string,
  ): Promise<{ blockedByMe: boolean; blockedMe: boolean }> {
    if (conversation.type !== ConversationType.PRIVATE) {
      return { blockedByMe: false, blockedMe: false };
    }
    const other = (conversation.members ?? []).find(
      (member) => member.userId !== actorId && !member.leftAt,
    );
    if (!other) {
      return { blockedByMe: false, blockedMe: false };
    }
    const [blockedByMe, blockedMe] = await Promise.all([
      this.hasBlock(actorId, other.userId),
      this.hasBlock(other.userId, actorId),
    ]);
    return { blockedByMe, blockedMe };
  }

  private async blockFlagsForConversations(
    conversations: Conversation[],
    actorId: string,
  ): Promise<Map<string, { blockedByMe: boolean; blockedMe: boolean }>> {
    const map = new Map<string, { blockedByMe: boolean; blockedMe: boolean }>();
    const privatePeers = conversations
      .filter((item) => item.type === ConversationType.PRIVATE)
      .map((item) => {
        const other = (item.members ?? []).find(
          (member) => member.userId !== actorId && !member.leftAt,
        );
        return other
          ? ({ conversationId: item.id, otherUserId: other.userId } as const)
          : null;
      })
      .filter((item): item is { conversationId: string; otherUserId: string } =>
        Boolean(item),
      );

    for (const item of conversations) {
      map.set(item.id, { blockedByMe: false, blockedMe: false });
    }

    if (privatePeers.length === 0) {
      return map;
    }

    const peerIds = [...new Set(privatePeers.map((item) => item.otherUserId))];
    const blocks = await this.userBlocks.find({
      where: [
        {
          organizationId: requireOrganizationId(),
          blockerId: actorId,
          blockedId: In(peerIds),
        },
        {
          organizationId: requireOrganizationId(),
          blockerId: In(peerIds),
          blockedId: actorId,
        },
      ],
    });

    const blockedByMe = new Set(
      blocks
        .filter((block) => block.blockerId === actorId)
        .map((block) => block.blockedId),
    );
    const blockedMe = new Set(
      blocks
        .filter((block) => block.blockedId === actorId)
        .map((block) => block.blockerId),
    );

    for (const peer of privatePeers) {
      map.set(peer.conversationId, {
        blockedByMe: blockedByMe.has(peer.otherUserId),
        blockedMe: blockedMe.has(peer.otherUserId),
      });
    }
    return map;
  }

  private async loadReplyParents(
    messages: Message[],
  ): Promise<Map<string, Message>> {
    const ids = [
      ...new Set(
        messages
          .map((item) => item.replyToMessageId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const map = new Map<string, Message>();
    if (ids.length === 0) {
      return map;
    }
    const parents = await this.messages.find({
      where: {
        id: In(ids),
        organizationId: requireOrganizationId(),
      },
    });
    for (const parent of parents) {
      map.set(parent.id, parent);
    }
    return map;
  }

  private async loadReactionsByMessageIds(
    messageIds: string[],
  ): Promise<Map<string, MessageReaction[]>> {
    const map = new Map<string, MessageReaction[]>();
    if (messageIds.length === 0) {
      return map;
    }
    const reactions = await this.messageReactions.find({
      where: { messageId: In(messageIds) },
    });
    for (const reaction of reactions) {
      const list = map.get(reaction.messageId) ?? [];
      list.push(reaction);
      map.set(reaction.messageId, list);
    }
    return map;
  }

  private buildReactionViews(
    reactions: MessageReaction[],
    actorId?: string,
  ): MessageReactionView[] {
    const byEmoji = new Map<string, { count: number; reactedByMe: boolean }>();
    for (const reaction of reactions) {
      const current = byEmoji.get(reaction.emoji) ?? {
        count: 0,
        reactedByMe: false,
      };
      current.count += 1;
      if (actorId && reaction.userId === actorId) {
        current.reactedByMe = true;
      }
      byEmoji.set(reaction.emoji, current);
    }
    return [...byEmoji.entries()].map(([emoji, data]) => ({
      emoji,
      count: data.count,
      reactedByMe: data.reactedByMe,
    }));
  }

  private async requireMembership(
    conversationId: string,
    actorId: string,
  ): Promise<Conversation> {
    const conversation = await this.conversations.findOne({
      where: {
        id: conversationId,
        organizationId: requireOrganizationId(),
      },
      relations: { members: true },
    });
    if (!conversation) {
      return RpcErrors.notFound('Conversation');
    }
    const membership = conversation.members.find(
      (member) => member.userId === actorId && !member.leftAt,
    );
    if (!membership) {
      return RpcErrors.forbidden('You are not a member of this conversation');
    }
    conversation.members = conversation.members.filter(
      (member) => !member.leftAt,
    );
    return conversation;
  }

  private assertGroupAdmin(conversation: Conversation, actorId: string): void {
    if (conversation.type !== ConversationType.GROUP) {
      return RpcErrors.badRequest(
        'Only group conversations support this action',
      );
    }
    const membership = conversation.members.find(
      (member) => member.userId === actorId,
    );
    if (
      !membership ||
      (membership.role !== ConversationMemberRole.OWNER &&
        membership.role !== ConversationMemberRole.ADMIN)
    ) {
      return RpcErrors.forbidden(
        'Only group owners or admins can manage members',
      );
    }
  }

  private async unreadCountFor(
    actorId: string,
    conversationId: string,
  ): Promise<number> {
    const counts = await this.unreadCounts(actorId, [conversationId]);
    return counts.get(conversationId) ?? 0;
  }

  private async unreadCounts(
    actorId: string,
    conversationIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (conversationIds.length === 0) {
      return counts;
    }

    const rows = await this.messages
      .createQueryBuilder('m')
      .select('m.conversationId', 'conversationId')
      .addSelect('COUNT(*)', 'count')
      .innerJoin(
        ConversationMember,
        'cm',
        'cm.conversationId = m.conversationId AND cm.userId = :actorId AND cm.leftAt IS NULL',
        { actorId },
      )
      .where('m.conversationId IN (:...conversationIds)', { conversationIds })
      .andWhere('m.organizationId = :organizationId', {
        organizationId: requireOrganizationId(),
      })
      .andWhere('m.senderId != :actorId', { actorId })
      .andWhere('(cm.lastReadAt IS NULL OR m.createdAt > cm.lastReadAt)')
      .andWhere('m.deletedForEveryoneAt IS NULL')
      .andWhere('(m.undelivered = false OR m.senderId = :actorId)', { actorId })
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM message_hides mh
          WHERE mh."messageId" = m.id AND mh."userId" = :actorId
        )`,
      )
      .groupBy('m.conversationId')
      .getRawMany<{ conversationId: string; count: string }>();

    for (const row of rows) {
      counts.set(row.conversationId, Number(row.count));
    }
    return counts;
  }

  /** Oldest unread @mention message id per conversation for the actor. */
  private async unreadMentionMeta(
    actorId: string,
    conversationIds: string[],
  ): Promise<Map<string, string>> {
    const firstByConversation = new Map<string, string>();
    if (conversationIds.length === 0) {
      return firstByConversation;
    }

    const mentionJson = JSON.stringify([actorId]);
    const rows = await this.messages
      .createQueryBuilder('m')
      .select('m.conversationId', 'conversationId')
      .addSelect('m.id', 'messageId')
      .distinctOn(['m.conversationId'])
      .innerJoin(
        ConversationMember,
        'cm',
        'cm.conversationId = m.conversationId AND cm.userId = :actorId AND cm.leftAt IS NULL',
        { actorId },
      )
      .where('m.conversationId IN (:...conversationIds)', { conversationIds })
      .andWhere('m.organizationId = :organizationId', {
        organizationId: requireOrganizationId(),
      })
      .andWhere('m.senderId != :actorId', { actorId })
      .andWhere('(cm.lastReadAt IS NULL OR m.createdAt > cm.lastReadAt)')
      .andWhere('m.deletedForEveryoneAt IS NULL')
      .andWhere('(m.undelivered = false OR m.senderId = :actorId)', { actorId })
      .andWhere('m.mentions @> CAST(:mentionJson AS jsonb)', { mentionJson })
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM message_hides mh
          WHERE mh."messageId" = m.id AND mh."userId" = :actorId
        )`,
      )
      .orderBy('m.conversationId')
      .addOrderBy('m.createdAt', 'ASC')
      .getRawMany<{ conversationId: string; messageId: string }>();

    for (const row of rows) {
      firstByConversation.set(row.conversationId, row.messageId);
    }
    return firstByConversation;
  }

  private async latestMessagesByConversation(
    conversationIds: string[],
    actorId: string,
  ): Promise<Map<string, Message>> {
    const latest = new Map<string, Message>();
    if (conversationIds.length === 0) {
      return latest;
    }

    // Prefer a non-deleted-for-everyone preview when available; otherwise keep
    // the newest row so toMessageView can render a deleted placeholder.
    // Undelivered (blocked) messages are only visible to the sender.
    const rows = await this.messages
      .createQueryBuilder('m')
      .distinctOn(['m.conversationId'])
      .where('m.conversationId IN (:...conversationIds)', { conversationIds })
      .andWhere('m.organizationId = :organizationId', {
        organizationId: requireOrganizationId(),
      })
      .andWhere('(m.undelivered = false OR m.senderId = :actorId)', { actorId })
      .orderBy('m.conversationId')
      .addOrderBy('CASE WHEN m.deletedForEveryoneAt IS NULL THEN 0 ELSE 1 END')
      .addOrderBy('m.createdAt', 'DESC')
      .getMany();

    for (const row of rows) {
      latest.set(row.conversationId, row);
    }
    return latest;
  }

  private recipientIds(conversation: Conversation): string[] {
    return (conversation.members ?? [])
      .filter((member) => !member.leftAt)
      .map((member) => member.userId);
  }

  private mutedRecipientIds(conversation: Conversation): string[] {
    return (conversation.members ?? [])
      .filter((member) => !member.leftAt && member.mutedAt)
      .map((member) => member.userId);
  }

  private toConversationView(
    conversation: Conversation,
    actorId: string,
    unreadCount = 0,
    lastMessage: Message | null = null,
    blockFlags: { blockedByMe: boolean; blockedMe: boolean } = {
      blockedByMe: false,
      blockedMe: false,
    },
    hasUnreadMention = false,
    firstUnreadMentionMessageId: string | null = null,
  ): ConversationView {
    const activeMembers = (conversation.members ?? []).filter(
      (member) => !member.leftAt,
    );
    const actor = activeMembers.find((member) => member.userId === actorId);
    return {
      id: conversation.id,
      type: conversation.type,
      name: conversation.name,
      createdBy: conversation.createdBy,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      lastMessage: lastMessage
        ? this.toMessageView(lastMessage, activeMembers, null, [], actorId)
        : null,
      lastReadAt: actor?.lastReadAt?.toISOString() ?? null,
      muted: Boolean(actor?.mutedAt),
      pinned: Boolean(actor?.pinnedAt),
      disappearingDurationSeconds:
        conversation.disappearingDurationSeconds ?? 0,
      blockedByMe: blockFlags.blockedByMe,
      blockedMe: blockFlags.blockedMe,
      unreadCount,
      hasUnreadMention,
      firstUnreadMentionMessageId,
      members: activeMembers.map((member) => ({
        userId: member.userId,
        role: member.role,
        joinedAt: member.joinedAt.toISOString(),
        lastReadAt: member.lastReadAt?.toISOString() ?? null,
        muted: Boolean(member.mutedAt),
        status: PresenceStatus.OFFLINE,
        lastSeenAt: null,
      })),
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  private toMessageView(
    message: Message,
    members: ConversationMember[] = [],
    replyTo: Message | null = null,
    reactions: MessageReaction[] = [],
    actorId?: string,
  ): MessageView {
    const deletedForEveryone = Boolean(message.deletedForEveryoneAt);
    const undelivered = Boolean(message.undelivered);
    const seenBy = undelivered
      ? []
      : members
          .filter(
            (member) =>
              !member.leftAt &&
              member.userId !== message.senderId &&
              member.lastReadAt != null &&
              member.lastReadAt >= message.createdAt,
          )
          .map((member) => member.userId);

    let replyToView: MessageReplyView | null = null;
    if (replyTo) {
      const replyDeleted = Boolean(replyTo.deletedForEveryoneAt);
      const replyBody = replyDeleted
        ? ''
        : replyTo.body?.trim() ||
          (replyTo.attachmentMime?.startsWith('image/') ||
          replyTo.type === MessageType.IMAGE
            ? 'Photo'
            : replyTo.attachmentMime?.startsWith('audio/') ||
                replyTo.type === MessageType.AUDIO
              ? 'Voice message'
              : replyTo.type === MessageType.FILE || replyTo.attachmentUrl
                ? replyTo.attachmentName?.trim() || 'File'
                : replyTo.type === MessageType.CALL
                  ? 'Call'
                  : '');
      replyToView = {
        id: replyTo.id,
        senderId: replyTo.senderId,
        body: replyBody,
        type: replyTo.type ?? MessageType.TEXT,
        deletedForEveryone: replyDeleted,
      };
    }

    const hasAttachment = Boolean(message.attachmentUrl);

    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      body: deletedForEveryone ? '' : message.body,
      type: message.type ?? MessageType.TEXT,
      replyTo: replyToView,
      attachment:
        !deletedForEveryone && hasAttachment && message.attachmentUrl
          ? {
              url: message.attachmentUrl,
              mime: message.attachmentMime ?? '',
              name: message.attachmentName ?? '',
              size: message.attachmentSize ?? 0,
            }
          : null,
      reactions: deletedForEveryone
        ? []
        : this.buildReactionViews(reactions, actorId),
      mentions: deletedForEveryone ? [] : (message.mentions ?? []),
      linkPreview:
        !deletedForEveryone && message.linkPreview ? message.linkPreview : null,
      poll:
        !deletedForEveryone && message.poll
          ? this.toPollView(message.poll, actorId)
          : null,
      editedAt: message.editedAt?.toISOString() ?? null,
      pinned: Boolean(message.pinnedAt) && !deletedForEveryone,
      pinnedAt:
        !deletedForEveryone && message.pinnedAt
          ? message.pinnedAt.toISOString()
          : null,
      pinnedByUserId:
        !deletedForEveryone && message.pinnedAt
          ? (message.pinnedByUserId ?? null)
          : null,
      forwarded: Boolean(message.forwardedFromMessageId),
      deletedForEveryone,
      seenBy,
      undelivered,
      expiresAt:
        !deletedForEveryone && message.expiresAt
          ? message.expiresAt.toISOString()
          : null,
      createdAt: message.createdAt.toISOString(),
    };
  }

  private toPollView(
    poll: {
      question: string;
      options: Array<{ id: string; text: string; voterIds: string[] }>;
      allowMultiple: boolean;
      closed: boolean;
    },
    actorId?: string,
  ): PollView {
    const options = poll.options.map((option) => ({
      id: option.id,
      text: option.text,
      voteCount: option.voterIds.length,
      votedByMe: Boolean(actorId && option.voterIds.includes(actorId)),
    }));
    return {
      question: poll.question,
      options,
      allowMultiple: Boolean(poll.allowMultiple),
      closed: Boolean(poll.closed),
      totalVotes: options.reduce((sum, option) => sum + option.voteCount, 0),
    };
  }

  private toBookmarkView(
    bookmark: MessageBookmark,
    message: Message,
    actorId: string,
    conversation?: Conversation,
    reactions: MessageReaction[] = [],
  ): BookmarkView {
    const conv =
      conversation ??
      ({
        id: bookmark.conversationId,
        type: ConversationType.PRIVATE,
        name: null,
        members: [],
      } as unknown as Conversation);
    return {
      id: bookmark.id,
      conversationId: bookmark.conversationId,
      messageId: bookmark.messageId,
      createdAt: bookmark.createdAt.toISOString(),
      message: this.toMessageView(
        message,
        conv.members ?? [],
        null,
        reactions,
        actorId,
      ),
      conversationName: conv.name ?? null,
      conversationType: conv.type ?? ConversationType.PRIVATE,
    };
  }

  private toScheduledMessageView(item: ScheduledMessage): ScheduledMessageView {
    const hasAttachment = Boolean(item.attachmentUrl);
    return {
      id: item.id,
      conversationId: item.conversationId,
      senderId: item.senderId,
      body: item.body,
      type: item.type ?? MessageType.TEXT,
      replyToMessageId: item.replyToMessageId,
      attachment:
        hasAttachment && item.attachmentUrl
          ? {
              url: item.attachmentUrl,
              mime: item.attachmentMime ?? '',
              name: item.attachmentName ?? '',
              size: item.attachmentSize ?? 0,
            }
          : null,
      mentions: item.mentions ?? [],
      linkPreview: item.linkPreview ?? null,
      scheduledFor: item.scheduledFor.toISOString(),
      status: item.status,
      sentMessageId: item.sentMessageId,
      error: item.error,
      createdAt: item.createdAt.toISOString(),
    };
  }
}
