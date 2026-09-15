import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import {
  ConversationMemberRole,
  ConversationType,
  MessageType,
  PresenceStatus,
  RpcErrors,
  buildPaginatedResult,
  buildTsQuery,
  escapeIlikePattern,
  getSkipTake,
  isUuidToken,
  isValidReactionEmoji,
  parseMessageSearchQuery,
} from '@app/common';
import type { ParsedMessageSearch, SearchHasKind } from '@app/common';
import type {
  AcceptChannelInvitePayload,
  AddChannelBookmarkPayload,
  AddMembersPayload,
  BlockUserPayload,
  BlockView,
  ChatAnalyticsView,
  AuditEventView,
  ChannelInviteView,
  ConversationActorPayload,
  ConversationView,
  CreateChannelInvitePayload,
  CreateGroupChatPayload,
  CreateIncomingWebhookPayload,
  CreatePollPayload,
  CreatePrivateChatPayload,
  CreateSlashCommandPayload,
  DeleteMessagePayload,
  DeleteMessageResult,
  EditMessagePayload,
  ForwardMessagePayload,
  IncomingWebhookView,
  InvokeSlashCommandPayload,
  InvokeSlashCommandResult,
  JoinChannelPayload,
  ListAuditPayload,
  ListBookmarksPayload,
  ListConversationsPayload,
  ListIncomingWebhooksPayload,
  ListSlashCommandsPayload,
  ListMediaPayload,
  ListMessageEditsPayload,
  ListMessagesPayload,
  ListMyThreadsPayload,
  ListThreadRepliesPayload,
  FollowThreadPayload,
  UnfollowThreadPayload,
  MarkThreadReadPayload,
  GetMessagePayload,
  LogAuditPayload,
  MarkSeenPayload,
  MessageEditHistoryView,
  MessageReactionView,
  MessageReplyView,
  MessageView,
  MuteConversationPayload,
  PinConversationPayload,
  PinMessagePayload,
  PollView,
  PostIncomingWebhookPayload,
  ReactMessagePayload,
  RemoveBookmarkPayload,
  RemoveChannelBookmarkPayload,
  RemoveMemberPayload,
  RevokeChannelInvitePayload,
  RevokeIncomingWebhookPayload,
  RevokeSlashCommandPayload,
  GlobalSearchHitView,
  GlobalSearchMessagesPayload,
  CancelScheduledMessagePayload,
  SaveBookmarkPayload,
  BookmarkView,
  ScheduleMessagePayload,
  ScheduledMessageView,
  SlashCommandView,
  UpsertDraftPayload,
  DraftView,
  CreateReminderPayload,
  CancelReminderPayload,
  CreateSidebarSectionPayload,
  DeleteSidebarSectionPayload,
  CreateUserGroupPayload,
  DeleteUserGroupPayload,
  ListUserGroupsPayload,
  UpdateUserGroupPayload,
  UserGroupView,
  MessageReminderView,
  ReminderDispatchResult,
  SearchMessagesPayload,
  SeenResultView,
  SendMessagePayload,
  SendMessageResult,
  SetDisappearingPayload,
  SetMemberRolePayload,
  SidebarSectionView,
  ThreadSummaryView,
  UpdateGroupPayload,
  UpdateSidebarSectionPayload,
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
import { MessageDraft } from '../database/entities/message-draft.entity';
import { MessageReminder } from '../database/entities/message-reminder.entity';
import { ThreadFollow } from '../database/entities/thread-follow.entity';
import { MessageEdit } from '../database/entities/message-edit.entity';
import { SidebarSection } from '../database/entities/sidebar-section.entity';
import { IncomingWebhook } from '../database/entities/incoming-webhook.entity';
import { SlashCommand } from '../database/entities/slash-command.entity';
import { UserGroup } from '../database/entities/user-group.entity';
import { UserBlock } from '../database/entities/user-block.entity';
import { AuditEvent } from '../database/entities/audit-event.entity';
import { WorkspaceSettings } from '../database/entities/workspace-settings.entity';
import { ChannelInvite } from '../database/entities/channel-invite.entity';

function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isGeneralChannelName(name: string): boolean {
  return name.trim().toLowerCase().replace(/^#/, '') === 'general';
}

const MAX_GROUP_MEMBERS = 50;
const DELETE_FOR_EVERYONE_WINDOW_MS = 0; // 0 = no time limit (sender can always delete for everyone)

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const SCHEDULE_MIN_DELAY_MS = 60 * 1000;
const SCHEDULE_MAX_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PENDING_SCHEDULED_PER_CHAT = 20;
const REMIND_MIN_DELAY_MS = 60 * 1000;
const REMIND_MAX_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_DRAFT_BODY = 4000;
const DISAPPEARING_DURATIONS = new Set([
  0, 30, 60, 3600, 86_400, 604_800, 7_776_000,
]);

const BUILTIN_SLASH_COMMANDS: Array<{
  name: string;
  description: string;
}> = [
  { name: 'shrug', description: 'Append ¯\\_(ツ)_/¯ to your message' },
  { name: 'me', description: 'Post an action line (*does something*)' },
  { name: 'status', description: 'Set your custom status (ephemeral)' },
  { name: 'help', description: 'List available slash commands' },
];

const RESERVED_SLASH_NAMES = new Set(
  BUILTIN_SLASH_COMMANDS.map((item) => item.name),
);

const RESERVED_USER_GROUP_HANDLES = new Set(['channel', 'here', 'everyone']);

export function privatePairKey(userA: string, userB: string): string {
  return [userA, userB].sort().join(':');
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
    @InjectRepository(MessageDraft)
    private readonly messageDrafts: Repository<MessageDraft>,
    @InjectRepository(MessageReminder)
    private readonly messageReminders: Repository<MessageReminder>,
    @InjectRepository(ThreadFollow)
    private readonly threadFollows: Repository<ThreadFollow>,
    @InjectRepository(MessageEdit)
    private readonly messageEdits: Repository<MessageEdit>,
    @InjectRepository(SidebarSection)
    private readonly sidebarSections: Repository<SidebarSection>,
    @InjectRepository(UserBlock)
    private readonly userBlocks: Repository<UserBlock>,
    @InjectRepository(AuditEvent)
    private readonly auditEvents: Repository<AuditEvent>,
    @InjectRepository(WorkspaceSettings)
    private readonly workspaceSettings: Repository<WorkspaceSettings>,
    @InjectRepository(ChannelInvite)
    private readonly channelInvites: Repository<ChannelInvite>,
    @InjectRepository(IncomingWebhook)
    private readonly incomingWebhooks: Repository<IncomingWebhook>,
    @InjectRepository(SlashCommand)
    private readonly slashCommands: Repository<SlashCommand>,
    @InjectRepository(UserGroup)
    private readonly userGroups: Repository<UserGroup>,
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
            visibility: isGeneralChannelName(name)
              ? 'public'
              : payload.visibility === 'public'
                ? 'public'
                : 'private',
            announceOnly: Boolean(payload.announceOnly),
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

    await this.recordAudit(
      payload.actorId,
      'conversation.created',
      'conversation',
      saved.id,
      {
        type: 'group',
        name: saved.name,
        visibility: saved.visibility,
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

    // Sort/paginate without hydrating every member graph first.
    const lightweight = await this.conversations.find({
      where: {
        id: In(conversationIds),
        organizationId: requireOrganizationId(),
      },
      select: {
        id: true,
        type: true,
        name: true,
        createdAt: true,
        lastMessageAt: true,
        createdBy: true,
        visibility: true,
        announceOnly: true,
        topic: true,
        description: true,
        disappearingDurationSeconds: true,
      },
    });

    lightweight.sort((a, b) => {
      const aPinned = pinnedAtByConversation.get(a.id) != null ? 1 : 0;
      const bPinned = pinnedAtByConversation.get(b.id) != null ? 1 : 0;
      if (aPinned !== bPinned) {
        return bPinned - aPinned;
      }
      const aTime = a.lastMessageAt?.getTime() ?? a.createdAt.getTime();
      const bTime = b.lastMessageAt?.getTime() ?? b.createdAt.getTime();
      return bTime - aTime;
    });

    const total = lightweight.length;
    const { skip, take } = getSkipTake(payload.page, payload.limit);
    const pageIds = lightweight.slice(skip, skip + take).map((item) => item.id);
    if (pageIds.length === 0) {
      return buildPaginatedResult([], total, payload.page, payload.limit);
    }

    const pageItems = await this.conversations.find({
      where: {
        id: In(pageIds),
        organizationId: requireOrganizationId(),
      },
      relations: { members: true },
    });
    const order = new Map(pageIds.map((id, index) => [id, index] as const));
    pageItems.sort(
      (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    );
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
    const qb = this.messages
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
      });

    if (payload.excludeThreadReplies !== false) {
      qb.andWhere('m.threadRootId IS NULL');
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
    const replyCounts = await this.loadThreadReplyCounts(
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
          replyCounts.get(item.id) ?? 0,
        ),
      ),
      total,
      payload.page,
      payload.limit,
    );
  }

  async listThreadReplies(payload: ListThreadRepliesPayload) {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    const root = await this.messages.findOne({
      where: {
        id: payload.threadRootId,
        conversationId: payload.conversationId,
        organizationId: requireOrganizationId(),
      },
    });
    if (!root || root.threadRootId != null) {
      return RpcErrors.notFound('Thread root message');
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
      .andWhere('m.threadRootId = :threadRootId', {
        threadRootId: payload.threadRootId,
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
      .orderBy('m.createdAt', 'ASC')
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
          0,
        ),
      ),
      total,
      payload.page,
      payload.limit,
    );
  }

  async listMyThreads(payload: ListMyThreadsPayload) {
    const { skip, take } = getSkipTake(payload.page, payload.limit);
    const organizationId = requireOrganizationId();

    const [follows, total] = await this.threadFollows.findAndCount({
      where: {
        organizationId,
        userId: payload.actorId,
      },
      order: { updatedAt: 'DESC' },
      skip,
      take,
    });

    if (follows.length === 0) {
      return buildPaginatedResult([], total, payload.page, payload.limit);
    }

    const rootIds = follows.map((row) => row.threadRootId);
    const roots = await this.messages.find({
      where: { id: In(rootIds), organizationId },
    });
    const rootById = new Map(roots.map((item) => [item.id, item]));

    const replyStats: Array<{
      threadRootId: string;
      replyCount: string;
      lastReplyAt: Date | null;
      unreadCount: string;
    }> = await this.messages
      .createQueryBuilder('reply')
      .select('reply.threadRootId', 'threadRootId')
      .addSelect('COUNT(reply.id)', 'replyCount')
      .addSelect('MAX(reply.createdAt)', 'lastReplyAt')
      .addSelect(
        `SUM(CASE
          WHEN reply.senderId <> :actorId
           AND (
             follow."lastReadAt" IS NULL
             OR reply.createdAt > follow."lastReadAt"
           )
          THEN 1 ELSE 0 END)`,
        'unreadCount',
      )
      .innerJoin(
        ThreadFollow,
        'follow',
        'follow.threadRootId = reply.threadRootId AND follow.userId = :actorId',
      )
      .where('reply.threadRootId IN (:...rootIds)', { rootIds })
      .andWhere('reply.organizationId = :organizationId', { organizationId })
      .andWhere('reply.deletedForEveryoneAt IS NULL')
      .setParameter('actorId', payload.actorId)
      .groupBy('reply.threadRootId')
      .addGroupBy('follow.lastReadAt')
      .getRawMany();

    const statsByRoot = new Map(
      replyStats.map((row) => [row.threadRootId, row]),
    );

    const latestReplies = await this.messages
      .createQueryBuilder('m')
      .distinctOn(['m.threadRootId'])
      .where('m.threadRootId IN (:...rootIds)', { rootIds })
      .andWhere('m.organizationId = :organizationId', { organizationId })
      .andWhere('m.deletedForEveryoneAt IS NULL')
      .orderBy('m.threadRootId', 'ASC')
      .addOrderBy('m.createdAt', 'DESC')
      .getMany();
    const latestByRoot = new Map(
      latestReplies.map((item) => [item.threadRootId as string, item]),
    );

    const conversationIdSet = [
      ...new Set(follows.map((row) => row.conversationId)),
    ];
    const conversations = await this.conversations.find({
      where: { id: In(conversationIdSet), organizationId },
      relations: { members: true },
    });
    const conversationById = new Map(
      conversations.map((item) => [item.id, item]),
    );

    const allMessageIds = [
      ...rootIds,
      ...latestReplies.map((item) => item.id),
    ];
    const reactionMap = await this.loadReactionsByMessageIds(allMessageIds);

    const items: ThreadSummaryView[] = [];
    for (const follow of follows) {
      const root = rootById.get(follow.threadRootId);
      const conversation = conversationById.get(follow.conversationId);
      if (!root || !conversation || root.deletedForEveryoneAt) {
        continue;
      }
      const stats = statsByRoot.get(follow.threadRootId);
      const latest = latestByRoot.get(follow.threadRootId) ?? null;
      const members = (conversation.members ?? []).filter((m) => !m.leftAt);
      const replyCount = Number(stats?.replyCount ?? 0);
      const unreadCount = Number(stats?.unreadCount ?? 0);
      const lastReplyAt = stats?.lastReplyAt
        ? new Date(stats.lastReplyAt).toISOString()
        : root.createdAt.toISOString();
      items.push({
        conversationId: conversation.id,
        conversationName: conversation.name,
        conversationType: conversation.type,
        root: this.toMessageView(
          root,
          members,
          null,
          reactionMap.get(root.id) ?? [],
          payload.actorId,
          replyCount,
        ),
        latestReply: latest
          ? this.toMessageView(
              latest,
              members,
              null,
              reactionMap.get(latest.id) ?? [],
              payload.actorId,
              0,
            )
          : null,
        replyCount,
        lastReplyAt,
        followed: true,
        unreadCount,
        hasUnread: unreadCount > 0,
      });
    }

    items.sort(
      (a, b) =>
        new Date(b.lastReplyAt).getTime() - new Date(a.lastReplyAt).getTime(),
    );

    return buildPaginatedResult(items, total, payload.page, payload.limit);
  }

  async followThread(payload: FollowThreadPayload): Promise<ThreadSummaryView> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    const root = await this.messages.findOne({
      where: {
        id: payload.threadRootId,
        conversationId: conversation.id,
        organizationId: requireOrganizationId(),
      },
    });
    if (!root || root.threadRootId != null) {
      return RpcErrors.notFound('Thread root message');
    }
    await this.upsertThreadFollow({
      organizationId: requireOrganizationId(),
      conversationId: conversation.id,
      threadRootId: root.id,
      userId: payload.actorId,
      markRead: true,
    });
    const list = await this.listMyThreads({
      actorId: payload.actorId,
      page: 1,
      limit: 100,
    });
    const hit = list.items.find((item) => item.root.id === root.id);
    if (hit) {
      return hit;
    }
    const members = (conversation.members ?? []).filter((m) => !m.leftAt);
    return {
      conversationId: conversation.id,
      conversationName: conversation.name,
      conversationType: conversation.type,
      root: this.toMessageView(root, members, null, [], payload.actorId, 0),
      latestReply: null,
      replyCount: 0,
      lastReplyAt: root.createdAt.toISOString(),
      followed: true,
      unreadCount: 0,
      hasUnread: false,
    };
  }

  async unfollowThread(
    payload: UnfollowThreadPayload,
  ): Promise<{ removed: boolean }> {
    await this.requireMembership(payload.conversationId, payload.actorId);
    const result = await this.threadFollows.delete({
      organizationId: requireOrganizationId(),
      threadRootId: payload.threadRootId,
      userId: payload.actorId,
    });
    return { removed: (result.affected ?? 0) > 0 };
  }

  async markThreadRead(
    payload: MarkThreadReadPayload,
  ): Promise<{ read: boolean }> {
    await this.requireMembership(payload.conversationId, payload.actorId);
    const follow = await this.threadFollows.findOne({
      where: {
        organizationId: requireOrganizationId(),
        threadRootId: payload.threadRootId,
        userId: payload.actorId,
      },
    });
    if (!follow) {
      return { read: false };
    }
    follow.lastReadAt = new Date();
    await this.threadFollows.save(follow);
    return { read: true };
  }

  private async upsertThreadFollow(input: {
    organizationId: string;
    conversationId: string;
    threadRootId: string;
    userId: string;
    markRead?: boolean;
  }): Promise<void> {
    let follow = await this.threadFollows.findOne({
      where: {
        threadRootId: input.threadRootId,
        userId: input.userId,
        organizationId: input.organizationId,
      },
    });
    if (!follow) {
      follow = this.threadFollows.create({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        threadRootId: input.threadRootId,
        userId: input.userId,
        lastReadAt: input.markRead ? new Date() : null,
      });
    } else if (input.markRead) {
      follow.lastReadAt = new Date();
    }
    await this.threadFollows.save(follow);
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

    const parsed = parseMessageSearchQuery(query);
    const senderIds = await this.resolveSearchSenderIds(
      parsed,
      payload.senderIds,
    );
    if (parsed.fromTokens.length > 0 && senderIds.length === 0) {
      return buildPaginatedResult([], 0, payload.page, payload.limit);
    }

    let conversationIds = [payload.conversationId];
    if (parsed.inChannels.length > 0) {
      const matched = await this.resolveSearchChannelIds(
        payload.actorId,
        parsed.inChannels,
        [payload.conversationId],
      );
      if (matched.length === 0) {
        return buildPaginatedResult([], 0, payload.page, payload.limit);
      }
      conversationIds = matched;
    }

    const { skip, take } = getSkipTake(payload.page, payload.limit);
    const qb = this.messages
      .createQueryBuilder('m')
      .where('m.conversationId IN (:...conversationIds)', { conversationIds })
      .andWhere('m.organizationId = :organizationId', {
        organizationId: requireOrganizationId(),
      });
    this.applyAdvancedSearchFilters(qb, {
      parsed,
      actorId: payload.actorId,
      senderIds,
    });

    const [items, total] = await qb
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

    const parsed = parseMessageSearchQuery(query);
    const hasOperators =
      parsed.fromTokens.length > 0 ||
      parsed.inChannels.length > 0 ||
      parsed.has.length > 0 ||
      Boolean(parsed.before) ||
      Boolean(parsed.after);
    if (!hasOperators && parsed.text.length < 2) {
      return buildPaginatedResult<GlobalSearchHitView>(
        [],
        0,
        payload.page,
        payload.limit,
      );
    }

    const senderIds = await this.resolveSearchSenderIds(
      parsed,
      payload.senderIds,
    );
    if (parsed.fromTokens.length > 0 && senderIds.length === 0) {
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
    let conversationIds = memberships.map((item) => item.conversationId);
    if (conversationIds.length === 0) {
      return buildPaginatedResult<GlobalSearchHitView>(
        [],
        0,
        payload.page,
        payload.limit,
      );
    }
    if (parsed.inChannels.length > 0) {
      conversationIds = await this.resolveSearchChannelIds(
        payload.actorId,
        parsed.inChannels,
        conversationIds,
      );
      if (conversationIds.length === 0) {
        return buildPaginatedResult<GlobalSearchHitView>(
          [],
          0,
          payload.page,
          payload.limit,
        );
      }
    }

    const { skip, take } = getSkipTake(payload.page, payload.limit);
    const qb = this.messages
      .createQueryBuilder('m')
      .where('m.conversationId IN (:...conversationIds)', { conversationIds })
      .andWhere('m.organizationId = :organizationId', {
        organizationId: requireOrganizationId(),
      });
    this.applyAdvancedSearchFilters(qb, {
      parsed,
      actorId: payload.actorId,
      senderIds,
    });

    const [items, total] = await qb
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

    const mentionSet = new Set(
      [...new Set((payload.mentionUserIds ?? []).filter(Boolean))].filter(
        (userId) => userId !== payload.actorId,
      ),
    );

    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );

    if (conversation.announceOnly) {
      const membership = conversation.members.find(
        (member) => member.userId === payload.actorId && !member.leftAt,
      );
      if (
        !membership ||
        (membership.role !== ConversationMemberRole.OWNER &&
          membership.role !== ConversationMemberRole.ADMIN)
      ) {
        return RpcErrors.forbidden(
          'Only owners and admins can post in announce-only channels',
        );
      }
    }

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

    let threadRootId: string | null = null;
    if (payload.threadRootId) {
      const threadRoot = await this.messages.findOne({
        where: {
          id: payload.threadRootId,
          conversationId: conversation.id,
          organizationId: requireOrganizationId(),
        },
      });
      if (!threadRoot) {
        return RpcErrors.badRequest(
          'Thread root must be a message in this conversation',
        );
      }
      threadRootId = threadRoot.threadRootId ?? threadRoot.id;
    } else if (replyTo?.threadRootId) {
      threadRootId = replyTo.threadRootId;
    }

    const activeMemberIds = new Set(
      conversation.members.filter((m) => !m.leftAt).map((m) => m.userId),
    );

    if (
      conversation.type === ConversationType.GROUP &&
      /(^|[\s([{])@channel\b/i.test(body)
    ) {
      for (const memberId of activeMemberIds) {
        if (memberId !== payload.actorId) {
          mentionSet.add(memberId);
        }
      }
    }

    if (
      conversation.type === ConversationType.GROUP &&
      /(^|[\s([{])@here\b/i.test(body)
    ) {
      for (const userId of payload.onlineUserIds ?? []) {
        if (userId !== payload.actorId && activeMemberIds.has(userId)) {
          mentionSet.add(userId);
        }
      }
    }

    if (conversation.type === ConversationType.GROUP) {
      await this.expandUserGroupMentions(
        body,
        payload.actorId,
        activeMemberIds,
        mentionSet,
      );
    }

    const validMentions = [...mentionSet].filter((userId) =>
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
        threadRootId,
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

    let channelBroadcast: MessageView | undefined;
    let pushRecipientIds: string[] | undefined;

    if (threadRootId) {
      const organizationId = requireOrganizationId();
      const root = await this.messages.findOne({
        where: { id: threadRootId, organizationId },
      });
      await this.upsertThreadFollow({
        organizationId,
        conversationId: conversation.id,
        threadRootId,
        userId: payload.actorId,
        markRead: true,
      });
      if (root && root.senderId !== payload.actorId) {
        await this.upsertThreadFollow({
          organizationId,
          conversationId: conversation.id,
          threadRootId,
          userId: root.senderId,
          markRead: false,
        });
      }

      const followers = await this.threadFollows.find({
        where: { threadRootId, organizationId },
        select: { userId: true },
      });
      pushRecipientIds = [
        ...new Set([
          ...followers.map((row) => row.userId),
          ...validMentions,
        ]),
      ].filter((userId) => userId !== payload.actorId);

      if (payload.alsoSendToChannel) {
        const channelMsg = await this.messages.save(
          this.messages.create({
            organizationId,
            conversationId: conversation.id,
            senderId: payload.actorId,
            body,
            type,
            replyToMessageId: threadRootId,
            threadRootId: null,
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
                    Date.now() +
                      conversation.disappearingDurationSeconds * 1000,
                  )
                : null,
          }),
        );
        conversation.lastMessageAt = channelMsg.createdAt;
        await this.conversations.save(conversation);
        channelBroadcast = this.toMessageView(
          channelMsg,
          conversation.members,
          root,
          [],
          payload.actorId,
        );
      }
    }

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
      pushRecipientIds,
      channelBroadcast,
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
    if (body === message.body) {
      const replyToSame = message.replyToMessageId
        ? await this.messages.findOne({
            where: {
              id: message.replyToMessageId,
              organizationId: requireOrganizationId(),
            },
          })
        : null;
      const reactionsSame = await this.messageReactions.find({
        where: { messageId: message.id },
      });
      return {
        ...this.toMessageView(
          message,
          conversation.members,
          replyToSame,
          reactionsSame,
          payload.actorId,
        ),
        recipientIds: this.recipientIds(conversation),
      };
    }

    await this.messageEdits.save(
      this.messageEdits.create({
        organizationId: requireOrganizationId(),
        conversationId: conversation.id,
        messageId: message.id,
        editorId: payload.actorId,
        body: message.body,
      }),
    );

    message.body = body;
    message.editedAt = new Date();
    await this.messages.save(message);

    await this.recordAudit(
      payload.actorId,
      'message.edited',
      'message',
      message.id,
      { conversationId: conversation.id },
    );

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

  async listMessageEdits(
    payload: ListMessageEditsPayload,
  ): Promise<MessageEditHistoryView> {
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
      return RpcErrors.badRequest('Cannot view edits for a deleted message');
    }

    const versions = await this.messageEdits.find({
      where: {
        messageId: message.id,
        organizationId: requireOrganizationId(),
      },
      order: { createdAt: 'ASC' },
    });

    return {
      messageId: message.id,
      currentBody: message.body,
      currentEditedAt: message.editedAt?.toISOString() ?? null,
      versions: versions.map((row) => ({
        id: row.id,
        body: row.body,
        editorId: row.editorId,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async reactMessage(payload: ReactMessagePayload): Promise<SendMessageResult> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    const emoji = await this.resolveReactionEmoji(payload.emoji);
    if (!emoji) {
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
        emoji,
      },
    });
    if (existing) {
      await this.messageReactions.remove(existing);
    } else {
      await this.messageReactions.save(
        this.messageReactions.create({
          messageId: message.id,
          userId: payload.actorId,
          emoji,
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
    const mentionSet = new Set(
      [...new Set((payload.mentionUserIds ?? []).filter(Boolean))].filter(
        (userId) => userId !== payload.actorId,
      ),
    );
    if (conversation.type === ConversationType.GROUP) {
      if (/(^|[\s([{])@channel\b/i.test(body)) {
        for (const memberId of activeMemberIds) {
          if (memberId !== payload.actorId) {
            mentionSet.add(memberId);
          }
        }
      }
      await this.expandUserGroupMentions(
        body,
        payload.actorId,
        activeMemberIds,
        mentionSet,
      );
    }
    const validMentions = [...mentionSet].filter((userId) =>
      activeMemberIds.has(userId),
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

  async upsertDraft(payload: UpsertDraftPayload): Promise<DraftView> {
    await this.requireMembership(payload.conversationId, payload.actorId);
    const body = (payload.body ?? '').slice(0, MAX_DRAFT_BODY);
    const organizationId = requireOrganizationId();

    if (!body.trim()) {
      await this.messageDrafts.delete({
        organizationId,
        userId: payload.actorId,
        conversationId: payload.conversationId,
      });
      return {
        conversationId: payload.conversationId,
        body: '',
        updatedAt: new Date().toISOString(),
      };
    }

    let draft = await this.messageDrafts.findOne({
      where: {
        organizationId,
        userId: payload.actorId,
        conversationId: payload.conversationId,
      },
    });
    if (draft) {
      draft.body = body;
    } else {
      draft = this.messageDrafts.create({
        organizationId,
        userId: payload.actorId,
        conversationId: payload.conversationId,
        body,
      });
    }
    const saved = await this.messageDrafts.save(draft);
    return {
      conversationId: saved.conversationId,
      body: saved.body,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  async getDraft(payload: ConversationActorPayload): Promise<DraftView | null> {
    await this.requireMembership(payload.conversationId, payload.actorId);
    const draft = await this.messageDrafts.findOne({
      where: {
        organizationId: requireOrganizationId(),
        userId: payload.actorId,
        conversationId: payload.conversationId,
      },
    });
    if (!draft) {
      return null;
    }
    return {
      conversationId: draft.conversationId,
      body: draft.body,
      updatedAt: draft.updatedAt.toISOString(),
    };
  }

  async clearDraft(payload: ConversationActorPayload): Promise<{ cleared: true }> {
    await this.requireMembership(payload.conversationId, payload.actorId);
    await this.messageDrafts.delete({
      organizationId: requireOrganizationId(),
      userId: payload.actorId,
      conversationId: payload.conversationId,
    });
    return { cleared: true };
  }

  async createReminder(
    payload: CreateReminderPayload,
  ): Promise<MessageReminderView> {
    await this.requireMembership(payload.conversationId, payload.actorId);

    const remindAt = new Date(payload.remindAt);
    if (Number.isNaN(remindAt.getTime())) {
      return RpcErrors.badRequest('Invalid remindAt time');
    }
    const now = Date.now();
    if (remindAt.getTime() < now + REMIND_MIN_DELAY_MS) {
      return RpcErrors.badRequest('Remind at least 1 minute in the future');
    }
    if (remindAt.getTime() > now + REMIND_MAX_AHEAD_MS) {
      return RpcErrors.badRequest(
        'Reminder cannot be more than 30 days ahead',
      );
    }

    const message = await this.messages.findOne({
      where: {
        id: payload.messageId,
        conversationId: payload.conversationId,
        organizationId: requireOrganizationId(),
      },
    });
    if (!message || message.deletedForEveryoneAt) {
      return RpcErrors.notFound('Message');
    }

    const saved = await this.messageReminders.save(
      this.messageReminders.create({
        organizationId: requireOrganizationId(),
        userId: payload.actorId,
        conversationId: payload.conversationId,
        messageId: message.id,
        remindAt,
        status: 'pending',
        notifiedAt: null,
      }),
    );

    return this.toReminderView(saved, message.body);
  }

  async listReminders(payload: {
    actorId: string;
  }): Promise<MessageReminderView[]> {
    const items = await this.messageReminders.find({
      where: {
        organizationId: requireOrganizationId(),
        userId: payload.actorId,
        status: 'pending',
      },
      order: { remindAt: 'ASC' },
      take: 50,
    });
    if (items.length === 0) {
      return [];
    }
    const messageIds = [...new Set(items.map((item) => item.messageId))];
    const conversationIds = [
      ...new Set(items.map((item) => item.conversationId)),
    ];
    const [messages, conversations] = await Promise.all([
      this.messages.find({
        where: {
          id: In(messageIds),
          organizationId: requireOrganizationId(),
        },
        select: { id: true, body: true },
      }),
      this.conversations.find({
        where: {
          id: In(conversationIds),
          organizationId: requireOrganizationId(),
        },
        select: { id: true, name: true, type: true },
      }),
    ]);
    const bodyById = new Map(messages.map((m) => [m.id, m.body]));
    const conversationById = new Map(
      conversations.map((item) => [item.id, item]),
    );
    return items.map((item) => {
      const conversation = conversationById.get(item.conversationId);
      return this.toReminderView(
        item,
        bodyById.get(item.messageId) ?? '',
        conversation?.name ?? null,
        conversation?.type,
      );
    });
  }

  async cancelReminder(
    payload: CancelReminderPayload,
  ): Promise<MessageReminderView> {
    const item = await this.messageReminders.findOne({
      where: {
        id: payload.reminderId,
        organizationId: requireOrganizationId(),
        userId: payload.actorId,
      },
    });
    if (!item) {
      return RpcErrors.notFound('Reminder');
    }
    if (item.status !== 'pending') {
      return RpcErrors.badRequest('Only pending reminders can be cancelled');
    }
    item.status = 'cancelled';
    const saved = await this.messageReminders.save(item);
    return this.toReminderView(saved);
  }

  async dispatchDueReminders(): Promise<ReminderDispatchResult[]> {
    const due = await this.messageReminders.find({
      where: {
        status: 'pending',
        remindAt: LessThanOrEqual(new Date()),
      },
      order: { remindAt: 'ASC' },
      take: 25,
    });

    const delivered: ReminderDispatchResult[] = [];
    for (const row of due) {
      const claimed = await this.messageReminders.update(
        {
          id: row.id,
          organizationId: row.organizationId,
          status: 'pending',
        },
        { status: 'sent', notifiedAt: new Date() },
      );
      if (!claimed.affected) {
        continue;
      }

      let bodySnippet = '';
      try {
        const message = await runWithOrganization(row.organizationId, () =>
          this.messages.findOne({
            where: {
              id: row.messageId,
              organizationId: row.organizationId,
            },
            select: { id: true, body: true },
          }),
        );
        bodySnippet = (message?.body || 'Message reminder').slice(0, 120);
      } catch {
        bodySnippet = 'Message reminder';
      }

      delivered.push({
        id: row.id,
        organizationId: row.organizationId,
        userId: row.userId,
        conversationId: row.conversationId,
        messageId: row.messageId,
        bodySnippet,
        remindAt: row.remindAt.toISOString(),
      });
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
      await this.recordAudit(
        payload.actorId,
        'message.deleted',
        'message',
        message.id,
        {
          conversationId: conversation.id,
          forEveryone: true,
        },
      );
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

    await this.recordAudit(
      payload.actorId,
      'conversation.members_added',
      'conversation',
      conversation.id,
      { memberIds: uniqueIds },
    );

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
    await this.recordAudit(
      payload.actorId,
      'conversation.member_removed',
      'conversation',
      conversation.id,
      { memberId: payload.memberId },
    );
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
    await this.recordAudit(
      payload.actorId,
      'conversation.left',
      'conversation',
      conversation.id,
    );
    return { left: true };
  }

  async updateGroup(payload: UpdateGroupPayload): Promise<ConversationView> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    this.assertGroupAdmin(conversation, payload.actorId);

    if (
      payload.name === undefined &&
      payload.visibility === undefined &&
      payload.announceOnly === undefined &&
      payload.topic === undefined &&
      payload.description === undefined
    ) {
      return RpcErrors.badRequest('No group fields to update');
    }

    if (payload.name !== undefined) {
      const name = payload.name.trim();
      if (!name) {
        return RpcErrors.badRequest('Group name is required');
      }
      conversation.name = name;
      if (isGeneralChannelName(name)) {
        conversation.visibility = 'public';
      }
    }

    if (payload.visibility !== undefined) {
      if (payload.visibility !== 'public' && payload.visibility !== 'private') {
        return RpcErrors.badRequest('Visibility must be public or private');
      }
      if (
        isGeneralChannelName(conversation.name ?? '') &&
        payload.visibility === 'private'
      ) {
        return RpcErrors.badRequest('#general must remain a public channel');
      }
      conversation.visibility = payload.visibility;
    }

    if (payload.announceOnly !== undefined) {
      conversation.announceOnly = Boolean(payload.announceOnly);
    }

    if (payload.topic !== undefined) {
      const topic = payload.topic?.trim() || null;
      conversation.topic = topic ? topic.slice(0, 250) : null;
    }

    if (payload.description !== undefined) {
      const description = payload.description?.trim() || null;
      conversation.description = description
        ? description.slice(0, 2000)
        : null;
    }

    await this.conversations.save(conversation);
    return this.getConversation(payload);
  }

  async addChannelBookmark(
    payload: AddChannelBookmarkPayload,
  ): Promise<ConversationView> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    this.assertGroupAdmin(conversation, payload.actorId);

    const title = payload.title?.trim() ?? '';
    const url = payload.url?.trim() ?? '';
    if (!title || !url) {
      return RpcErrors.badRequest('Bookmark title and URL are required');
    }
    try {
      // eslint-disable-next-line no-new
      new URL(url);
    } catch {
      return RpcErrors.badRequest('Bookmark URL must be a valid absolute URL');
    }

    const existing = Array.isArray(conversation.bookmarks)
      ? conversation.bookmarks
      : [];
    if (existing.length >= 20) {
      return RpcErrors.badRequest('A channel can have at most 20 bookmarks');
    }

    conversation.bookmarks = [
      ...existing,
      {
        id: randomUUID(),
        title: title.slice(0, 80),
        url: url.slice(0, 2000),
        createdBy: payload.actorId,
        createdAt: new Date().toISOString(),
      },
    ];
    await this.conversations.save(conversation);
    return this.getConversation(payload);
  }

  async removeChannelBookmark(
    payload: RemoveChannelBookmarkPayload,
  ): Promise<ConversationView> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    this.assertGroupAdmin(conversation, payload.actorId);

    const existing = Array.isArray(conversation.bookmarks)
      ? conversation.bookmarks
      : [];
    conversation.bookmarks = existing.filter(
      (item) => item.id !== payload.bookmarkId,
    );
    await this.conversations.save(conversation);
    return this.getConversation(payload);
  }

  async listPublicChannels(payload: {
    actorId: string;
  }): Promise<Array<ConversationView & { isMember: boolean }>> {
    const items = await this.conversations.find({
      where: {
        organizationId: requireOrganizationId(),
        type: ConversationType.GROUP,
        visibility: 'public',
      },
      relations: { members: true },
      order: { name: 'ASC' },
    });

    return items.map((item) => {
      const isMember = (item.members ?? []).some(
        (member) => member.userId === payload.actorId && !member.leftAt,
      );
      return {
        ...this.toConversationView(item, payload.actorId),
        isMember,
      };
    });
  }

  async joinChannel(payload: JoinChannelPayload): Promise<ConversationView> {
    const conversation = await this.conversations.findOne({
      where: {
        id: payload.conversationId,
        organizationId: requireOrganizationId(),
      },
      relations: { members: true },
    });
    if (!conversation) {
      return RpcErrors.notFound('Conversation');
    }
    if (conversation.type !== ConversationType.GROUP) {
      return RpcErrors.badRequest('Only group channels can be joined');
    }

    const existing = conversation.members.find(
      (member) => member.userId === payload.actorId,
    );
    if (existing && !existing.leftAt) {
      return this.getConversation({
        actorId: payload.actorId,
        conversationId: conversation.id,
      });
    }

    if (conversation.visibility !== 'public') {
      return RpcErrors.forbidden('This channel is private');
    }

    if (existing?.leftAt) {
      existing.leftAt = null;
      existing.role = ConversationMemberRole.MEMBER;
      await this.members.save(existing);
    } else {
      await this.members.save(
        this.members.create({
          conversationId: conversation.id,
          userId: payload.actorId,
          role: ConversationMemberRole.MEMBER,
        }),
      );
    }

    await this.recordAudit(
      payload.actorId,
      'conversation.joined',
      'conversation',
      conversation.id,
      { visibility: conversation.visibility },
    );

    return this.getConversation({
      actorId: payload.actorId,
      conversationId: conversation.id,
    });
  }

  async createChannelInvite(
    payload: CreateChannelInvitePayload,
  ): Promise<ChannelInviteView> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    this.assertGroupAdmin(conversation, payload.actorId);

    if (payload.expiresInHours != null) {
      if (
        !Number.isFinite(payload.expiresInHours) ||
        payload.expiresInHours <= 0 ||
        payload.expiresInHours > 24 * 365
      ) {
        return RpcErrors.badRequest('expiresInHours must be between 1 and 8760');
      }
    }
    if (payload.maxUses != null) {
      if (
        !Number.isInteger(payload.maxUses) ||
        payload.maxUses <= 0 ||
        payload.maxUses > 10_000
      ) {
        return RpcErrors.badRequest('maxUses must be between 1 and 10000');
      }
    }

    const rawToken = randomBytes(32).toString('base64url');
    const invite = await this.channelInvites.save(
      this.channelInvites.create({
        organizationId: requireOrganizationId(),
        conversationId: conversation.id,
        tokenHash: hashInviteToken(rawToken),
        createdBy: payload.actorId,
        expiresAt:
          payload.expiresInHours != null
            ? new Date(Date.now() + payload.expiresInHours * 60 * 60 * 1000)
            : null,
        maxUses: payload.maxUses ?? null,
        useCount: 0,
        revokedAt: null,
      }),
    );

    return this.toChannelInviteView(invite, rawToken);
  }

  async acceptChannelInvite(
    payload: AcceptChannelInvitePayload,
  ): Promise<ConversationView> {
    const token = payload.token?.trim();
    if (!token) {
      return RpcErrors.badRequest('Invite token is required');
    }

    const invite = await this.channelInvites.findOne({
      where: {
        tokenHash: hashInviteToken(token),
        organizationId: requireOrganizationId(),
      },
    });
    if (!invite) {
      return RpcErrors.notFound('Channel invite');
    }
    if (invite.revokedAt) {
      return RpcErrors.forbidden('This invite has been revoked');
    }
    if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) {
      return RpcErrors.forbidden('This invite has expired');
    }
    if (invite.maxUses != null && invite.useCount >= invite.maxUses) {
      return RpcErrors.forbidden('This invite has reached its use limit');
    }

    const conversation = await this.conversations.findOne({
      where: {
        id: invite.conversationId,
        organizationId: requireOrganizationId(),
      },
      relations: { members: true },
    });
    if (!conversation || conversation.type !== ConversationType.GROUP) {
      return RpcErrors.notFound('Conversation');
    }

    const existing = conversation.members.find(
      (member) => member.userId === payload.actorId,
    );
    if (!existing || existing.leftAt) {
      if (existing?.leftAt) {
        existing.leftAt = null;
        existing.role = ConversationMemberRole.MEMBER;
        await this.members.save(existing);
      } else {
        await this.members.save(
          this.members.create({
            conversationId: conversation.id,
            userId: payload.actorId,
            role: ConversationMemberRole.MEMBER,
          }),
        );
      }
      invite.useCount += 1;
      await this.channelInvites.save(invite);
    }

    return this.getConversation({
      actorId: payload.actorId,
      conversationId: conversation.id,
    });
  }

  async revokeChannelInvite(
    payload: RevokeChannelInvitePayload,
  ): Promise<ChannelInviteView> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    this.assertGroupAdmin(conversation, payload.actorId);

    const invite = await this.channelInvites.findOne({
      where: {
        id: payload.inviteId,
        conversationId: conversation.id,
        organizationId: requireOrganizationId(),
      },
    });
    if (!invite) {
      return RpcErrors.notFound('Channel invite');
    }
    if (!invite.revokedAt) {
      invite.revokedAt = new Date();
      await this.channelInvites.save(invite);
    }
    return this.toChannelInviteView(invite, null);
  }

  async listChannelInvites(
    payload: ConversationActorPayload,
  ): Promise<ChannelInviteView[]> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    this.assertGroupAdmin(conversation, payload.actorId);

    const invites = await this.channelInvites.find({
      where: {
        conversationId: conversation.id,
        organizationId: requireOrganizationId(),
      },
      order: { createdAt: 'DESC' },
    });
    return invites.map((invite) => this.toChannelInviteView(invite, null));
  }

  async createIncomingWebhook(
    payload: CreateIncomingWebhookPayload,
  ): Promise<IncomingWebhookView> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    this.assertGroupAdmin(conversation, payload.actorId);

    const name = payload.name?.trim() ?? '';
    if (!name || name.length > 80) {
      return RpcErrors.badRequest('Webhook name is required (max 80 chars)');
    }
    const defaultUsername = (
      payload.defaultUsername?.trim() || name
    ).slice(0, 80);
    if (!defaultUsername) {
      return RpcErrors.badRequest('defaultUsername is required');
    }
    let defaultIconUrl = payload.defaultIconUrl?.trim() || null;
    if (defaultIconUrl) {
      if (defaultIconUrl.length > 500) {
        return RpcErrors.badRequest('defaultIconUrl is too long');
      }
      if (!/^https?:\/\//i.test(defaultIconUrl)) {
        return RpcErrors.badRequest(
          'defaultIconUrl must start with http:// or https://',
        );
      }
    }

    const rawToken = randomBytes(32).toString('base64url');
    const webhook = await this.incomingWebhooks.save(
      this.incomingWebhooks.create({
        organizationId: requireOrganizationId(),
        conversationId: conversation.id,
        name,
        tokenHash: hashInviteToken(rawToken),
        defaultUsername,
        defaultIconUrl,
        createdBy: payload.actorId,
        revokedAt: null,
        lastUsedAt: null,
      }),
    );

    await this.recordAudit(
      payload.actorId,
      'webhook.created',
      'incoming_webhook',
      webhook.id,
      { conversationId: conversation.id, name },
    );

    return this.toIncomingWebhookView(webhook, rawToken);
  }

  async listIncomingWebhooks(
    payload: ListIncomingWebhooksPayload,
  ): Promise<IncomingWebhookView[]> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    this.assertGroupAdmin(conversation, payload.actorId);

    const rows = await this.incomingWebhooks.find({
      where: {
        conversationId: conversation.id,
        organizationId: requireOrganizationId(),
      },
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => this.toIncomingWebhookView(row, null));
  }

  async revokeIncomingWebhook(
    payload: RevokeIncomingWebhookPayload,
  ): Promise<IncomingWebhookView> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );
    this.assertGroupAdmin(conversation, payload.actorId);

    const webhook = await this.incomingWebhooks.findOne({
      where: {
        id: payload.webhookId,
        conversationId: conversation.id,
        organizationId: requireOrganizationId(),
      },
    });
    if (!webhook) {
      return RpcErrors.notFound('Incoming webhook');
    }
    if (!webhook.revokedAt) {
      webhook.revokedAt = new Date();
      await this.incomingWebhooks.save(webhook);
      await this.recordAudit(
        payload.actorId,
        'webhook.revoked',
        'incoming_webhook',
        webhook.id,
        { conversationId: conversation.id },
      );
    }
    return this.toIncomingWebhookView(webhook, null);
  }

  async postIncomingWebhook(
    payload: PostIncomingWebhookPayload,
  ): Promise<SendMessageResult> {
    const token = payload.token?.trim();
    if (!token) {
      return RpcErrors.badRequest('Webhook token is required');
    }
    const text = payload.text?.trim() ?? '';
    if (!text) {
      return RpcErrors.badRequest('text is required');
    }
    if (text.length > 4000) {
      return RpcErrors.badRequest('text must be at most 4000 characters');
    }

    const webhook = await this.incomingWebhooks.findOne({
      where: { tokenHash: hashInviteToken(token) },
    });
    if (!webhook || webhook.revokedAt) {
      return RpcErrors.notFound('Incoming webhook');
    }

    const usernameOverride = payload.username?.trim();
    if (usernameOverride && usernameOverride.length > 80) {
      return RpcErrors.badRequest('username must be at most 80 characters');
    }

    return runWithOrganization(webhook.organizationId, async () => {
      const conversation = await this.conversations.findOne({
        where: {
          id: webhook.conversationId,
          organizationId: requireOrganizationId(),
        },
        relations: { members: true },
      });
      if (!conversation || conversation.type !== ConversationType.GROUP) {
        return RpcErrors.notFound('Conversation');
      }
      conversation.members = (conversation.members ?? []).filter(
        (member) => !member.leftAt,
      );

      const botUsername = (
        usernameOverride || webhook.defaultUsername
      ).slice(0, 80);
      const botIconUrl = webhook.defaultIconUrl;

      const saved = await this.messages.save(
        this.messages.create({
          organizationId: requireOrganizationId(),
          conversationId: conversation.id,
          senderId: webhook.createdBy,
          body: text,
          type: MessageType.TEXT,
          replyToMessageId: null,
          attachmentUrl: null,
          attachmentMime: null,
          attachmentName: null,
          attachmentSize: null,
          mentions: [],
          linkPreview: null,
          poll: null,
          botUsername,
          botIconUrl,
        }),
      );

      conversation.lastMessageAt = saved.createdAt;
      await this.conversations.save(conversation);

      webhook.lastUsedAt = new Date();
      await this.incomingWebhooks.save(webhook);

      await this.recordAudit(
        webhook.createdBy,
        'webhook.message_posted',
        'incoming_webhook',
        webhook.id,
        { conversationId: conversation.id, messageId: saved.id },
      );

      return {
        ...this.toMessageView(
          saved,
          conversation.members,
          null,
          [],
          webhook.createdBy,
        ),
        recipientIds: this.recipientIds(conversation),
      };
    });
  }

  async listSlashCommands(
    _payload: ListSlashCommandsPayload,
  ): Promise<SlashCommandView[]> {
    const builtins = BUILTIN_SLASH_COMMANDS.map((item) => ({
      id: `builtin:${item.name}`,
      name: item.name,
      description: item.description,
      responseTemplate: '',
      builtin: true,
      createdBy: null,
      revokedAt: null,
      createdAt: null,
    }));

    const custom = await this.slashCommands.find({
      where: {
        organizationId: requireOrganizationId(),
        revokedAt: IsNull(),
      },
      order: { name: 'ASC' },
    });

    return [
      ...builtins,
      ...custom.map((row) => this.toSlashCommandView(row)),
    ];
  }

  async createSlashCommand(
    payload: CreateSlashCommandPayload,
  ): Promise<SlashCommandView> {
    const name = this.normalizeSlashName(payload.name);
    if (!name) {
      return RpcErrors.badRequest(
        'Command name is required (letters, numbers, underscore; max 32)',
      );
    }
    if (RESERVED_SLASH_NAMES.has(name)) {
      return RpcErrors.badRequest(`/${name} is a built-in command`);
    }
    const description = payload.description?.trim() ?? '';
    if (!description || description.length > 160) {
      return RpcErrors.badRequest('Description is required (max 160 chars)');
    }
    const responseTemplate = payload.responseTemplate?.trim() ?? '';
    if (!responseTemplate || responseTemplate.length > 2000) {
      return RpcErrors.badRequest(
        'Response template is required (max 2000 chars)',
      );
    }

    const existing = await this.slashCommands.findOne({
      where: {
        organizationId: requireOrganizationId(),
        name,
        revokedAt: IsNull(),
      },
    });
    if (existing) {
      return RpcErrors.conflict(`/${name} already exists`);
    }

    const saved = await this.slashCommands.save(
      this.slashCommands.create({
        organizationId: requireOrganizationId(),
        name,
        description,
        responseTemplate,
        createdBy: payload.actorId,
        revokedAt: null,
      }),
    );

    await this.recordAudit(
      payload.actorId,
      'slash_command.created',
      'slash_command',
      saved.id,
      { name },
    );

    return this.toSlashCommandView(saved);
  }

  async revokeSlashCommand(
    payload: RevokeSlashCommandPayload,
  ): Promise<SlashCommandView> {
    const command = await this.slashCommands.findOne({
      where: {
        id: payload.commandId,
        organizationId: requireOrganizationId(),
      },
    });
    if (!command) {
      return RpcErrors.notFound('Slash command');
    }
    if (!command.revokedAt) {
      command.revokedAt = new Date();
      await this.slashCommands.save(command);
      await this.recordAudit(
        payload.actorId,
        'slash_command.revoked',
        'slash_command',
        command.id,
        { name: command.name },
      );
    }
    return this.toSlashCommandView(command);
  }

  async invokeSlashCommand(
    payload: InvokeSlashCommandPayload,
  ): Promise<InvokeSlashCommandResult> {
    const conversation = await this.requireMembership(
      payload.conversationId,
      payload.actorId,
    );

    const parsed = this.parseSlashInput(payload.raw);
    if (!parsed) {
      return RpcErrors.badRequest('Message must start with /command');
    }
    const { name, text } = parsed;

    if (name === 'help') {
      const commands = await this.listSlashCommands({
        actorId: payload.actorId,
      });
      const lines = commands.map(
        (item) =>
          `/${item.name} — ${item.description}${item.builtin ? '' : ' (custom)'}`,
      );
      return {
        kind: 'ephemeral',
        ephemeral: `Slash commands:\n${lines.join('\n')}`,
      };
    }

    if (name === 'status') {
      const customStatus = text.slice(0, 120) || null;
      return {
        kind: 'status',
        customStatus,
        ephemeral: customStatus
          ? `Status set to “${customStatus}”`
          : 'Custom status cleared',
      };
    }

    let body: string | null = null;
    if (name === 'shrug') {
      body = text ? `${text} ¯\\_(ツ)_/¯` : '¯\\_(ツ)_/¯';
    } else if (name === 'me') {
      if (!text) {
        return RpcErrors.badRequest('Usage: /me does something');
      }
      body = `_${text}_`;
    } else {
      const custom = await this.slashCommands.findOne({
        where: {
          organizationId: requireOrganizationId(),
          name,
          revokedAt: IsNull(),
        },
      });
      if (!custom) {
        return RpcErrors.badRequest(
          `Unknown command /${name}. Try /help`,
        );
      }
      body = custom.responseTemplate
        .replace(/\{text\}/gi, text)
        .replace(/\{user\}/gi, payload.actorId)
        .trim();
      if (!body) {
        return RpcErrors.badRequest('Command produced an empty message');
      }
    }

    if (body.length > 4000) {
      return RpcErrors.badRequest('Resulting message is too long');
    }

    if (conversation.announceOnly) {
      const membership = conversation.members.find(
        (member) => member.userId === payload.actorId && !member.leftAt,
      );
      if (
        !membership ||
        (membership.role !== ConversationMemberRole.OWNER &&
          membership.role !== ConversationMemberRole.ADMIN)
      ) {
        return RpcErrors.forbidden(
          'Only owners and admins can post in announce-only channels',
        );
      }
    }

    const saved = await this.messages.save(
      this.messages.create({
        organizationId: requireOrganizationId(),
        conversationId: conversation.id,
        senderId: payload.actorId,
        body,
        type: MessageType.TEXT,
        replyToMessageId: null,
        attachmentUrl: null,
        attachmentMime: null,
        attachmentName: null,
        attachmentSize: null,
        mentions: [],
        linkPreview: null,
        poll: null,
        botUsername: null,
        botIconUrl: null,
      }),
    );
    conversation.lastMessageAt = saved.createdAt;
    await this.conversations.save(conversation);

    return {
      kind: 'message',
      message: {
        ...this.toMessageView(
          saved,
          conversation.members,
          null,
          [],
          payload.actorId,
        ),
        recipientIds: this.recipientIds(conversation),
      },
    };
  }

  private normalizeSlashName(raw: string): string | null {
    const name = raw.trim().replace(/^\//, '').toLowerCase();
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(name)) {
      return null;
    }
    return name;
  }

  private parseSlashInput(
    raw: string,
  ): { name: string; text: string } | null {
    const trimmed = raw.trim();
    const match = trimmed.match(/^\/([a-zA-Z][a-zA-Z0-9_]{0,31})(?:\s+([\s\S]*))?$/);
    if (!match) {
      return null;
    }
    return {
      name: match[1].toLowerCase(),
      text: (match[2] ?? '').trim(),
    };
  }

  private toSlashCommandView(row: SlashCommand): SlashCommandView {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      responseTemplate: row.responseTemplate,
      builtin: false,
      createdBy: row.createdBy,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listUserGroups(
    _payload: ListUserGroupsPayload,
  ): Promise<UserGroupView[]> {
    const rows = await this.userGroups.find({
      where: { organizationId: requireOrganizationId() },
      order: { handle: 'ASC' },
    });
    return rows.map((row) => this.toUserGroupView(row));
  }

  async createUserGroup(
    payload: CreateUserGroupPayload,
  ): Promise<UserGroupView> {
    const handle = this.normalizeUserGroupHandle(payload.handle);
    if (!handle) {
      return RpcErrors.badRequest(
        'Handle is required (letters, numbers, underscore; max 32)',
      );
    }
    if (RESERVED_USER_GROUP_HANDLES.has(handle)) {
      return RpcErrors.badRequest(`@${handle} is reserved`);
    }
    const name = payload.name?.trim() ?? '';
    if (!name || name.length > 80) {
      return RpcErrors.badRequest('Name is required (max 80 chars)');
    }
    const description = payload.description?.trim() || null;
    if (description && description.length > 240) {
      return RpcErrors.badRequest('Description must be at most 240 chars');
    }
    const memberIds = this.normalizeMemberIds(payload.memberIds);
    if (memberIds.length === 0) {
      return RpcErrors.badRequest('Add at least one member');
    }

    const existing = await this.userGroups.findOne({
      where: {
        organizationId: requireOrganizationId(),
        handle,
      },
    });
    if (existing) {
      return RpcErrors.conflict(`@${handle} already exists`);
    }

    const saved = await this.userGroups.save(
      this.userGroups.create({
        organizationId: requireOrganizationId(),
        handle,
        name,
        description,
        memberIds,
        createdBy: payload.actorId,
      }),
    );

    await this.recordAudit(
      payload.actorId,
      'user_group.created',
      'user_group',
      saved.id,
      { handle, memberCount: memberIds.length },
    );

    return this.toUserGroupView(saved);
  }

  async updateUserGroup(
    payload: UpdateUserGroupPayload,
  ): Promise<UserGroupView> {
    const group = await this.userGroups.findOne({
      where: {
        id: payload.groupId,
        organizationId: requireOrganizationId(),
      },
    });
    if (!group) {
      return RpcErrors.notFound('User group');
    }

    if (payload.handle !== undefined) {
      const handle = this.normalizeUserGroupHandle(payload.handle);
      if (!handle) {
        return RpcErrors.badRequest(
          'Handle is required (letters, numbers, underscore; max 32)',
        );
      }
      if (RESERVED_USER_GROUP_HANDLES.has(handle)) {
        return RpcErrors.badRequest(`@${handle} is reserved`);
      }
      if (handle !== group.handle) {
        const clash = await this.userGroups.findOne({
          where: {
            organizationId: requireOrganizationId(),
            handle,
          },
        });
        if (clash) {
          return RpcErrors.conflict(`@${handle} already exists`);
        }
        group.handle = handle;
      }
    }

    if (payload.name !== undefined) {
      const name = payload.name.trim();
      if (!name || name.length > 80) {
        return RpcErrors.badRequest('Name is required (max 80 chars)');
      }
      group.name = name;
    }

    if (payload.description !== undefined) {
      const description = payload.description?.trim() || null;
      if (description && description.length > 240) {
        return RpcErrors.badRequest('Description must be at most 240 chars');
      }
      group.description = description;
    }

    if (payload.memberIds !== undefined) {
      const memberIds = this.normalizeMemberIds(payload.memberIds);
      if (memberIds.length === 0) {
        return RpcErrors.badRequest('Add at least one member');
      }
      group.memberIds = memberIds;
    }

    const saved = await this.userGroups.save(group);
    await this.recordAudit(
      payload.actorId,
      'user_group.updated',
      'user_group',
      saved.id,
      { handle: saved.handle },
    );
    return this.toUserGroupView(saved);
  }

  async deleteUserGroup(
    payload: DeleteUserGroupPayload,
  ): Promise<{ deleted: boolean }> {
    const group = await this.userGroups.findOne({
      where: {
        id: payload.groupId,
        organizationId: requireOrganizationId(),
      },
    });
    if (!group) {
      return RpcErrors.notFound('User group');
    }
    await this.userGroups.remove(group);
    await this.recordAudit(
      payload.actorId,
      'user_group.deleted',
      'user_group',
      payload.groupId,
      { handle: group.handle },
    );
    return { deleted: true };
  }

  private async expandUserGroupMentions(
    body: string,
    actorId: string,
    activeMemberIds: Set<string>,
    mentionSet: Set<string>,
  ): Promise<void> {
    const handles = new Set<string>();
    const pattern = /(^|[\s([{])@([a-z][a-z0-9_]{0,31})\b/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      const handle = match[2].toLowerCase();
      if (!RESERVED_USER_GROUP_HANDLES.has(handle)) {
        handles.add(handle);
      }
    }
    if (handles.size === 0) {
      return;
    }

    const groups = await this.userGroups.find({
      where: {
        organizationId: requireOrganizationId(),
        handle: In([...handles]),
      },
    });
    for (const group of groups) {
      for (const memberId of group.memberIds ?? []) {
        if (memberId !== actorId && activeMemberIds.has(memberId)) {
          mentionSet.add(memberId);
        }
      }
    }
  }

  private normalizeUserGroupHandle(raw: string): string | null {
    const handle = raw.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(handle)) {
      return null;
    }
    return handle;
  }

  private normalizeMemberIds(raw: string[] | undefined): string[] {
    return [
      ...new Set(
        (raw ?? [])
          .map((id) => id?.trim())
          .filter((id): id is string => Boolean(id) && isUuidToken(id)),
      ),
    ];
  }

  private toUserGroupView(row: UserGroup): UserGroupView {
    return {
      id: row.id,
      handle: row.handle,
      name: row.name,
      description: row.description,
      memberIds: Array.isArray(row.memberIds) ? row.memberIds : [],
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
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
    await this.recordAudit(
      payload.actorId,
      'conversation.deleted',
      'conversation',
      conversation.id,
      { name: conversation.name },
    );
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

  async listSidebarSections(actorId: string): Promise<SidebarSectionView[]> {
    const rows = await this.sidebarSections.find({
      where: {
        organizationId: requireOrganizationId(),
        userId: actorId,
      },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return rows.map((row) => this.toSidebarSectionView(row));
  }

  async createSidebarSection(
    payload: CreateSidebarSectionPayload,
  ): Promise<SidebarSectionView> {
    const name = payload.name.trim().slice(0, 80);
    if (!name) {
      return RpcErrors.badRequest('Section name is required');
    }
    const organizationId = requireOrganizationId();
    const existing = await this.sidebarSections.findOne({
      where: {
        organizationId,
        userId: payload.actorId,
        name,
      },
    });
    if (existing) {
      return RpcErrors.conflict('A section with that name already exists');
    }
    const maxOrder = await this.sidebarSections
      .createQueryBuilder('section')
      .select('MAX(section.sortOrder)', 'max')
      .where('section.organizationId = :organizationId', { organizationId })
      .andWhere('section.userId = :userId', { userId: payload.actorId })
      .getRawOne<{ max: string | null }>();
    const sortOrder = Number(maxOrder?.max ?? -1) + 1;
    const saved = await this.sidebarSections.save(
      this.sidebarSections.create({
        organizationId,
        userId: payload.actorId,
        name,
        sortOrder,
        collapsed: false,
        conversationIds: [],
      }),
    );
    return this.toSidebarSectionView(saved);
  }

  async updateSidebarSection(
    payload: UpdateSidebarSectionPayload,
  ): Promise<SidebarSectionView> {
    const section = await this.sidebarSections.findOne({
      where: {
        id: payload.sectionId,
        organizationId: requireOrganizationId(),
        userId: payload.actorId,
      },
    });
    if (!section) {
      return RpcErrors.notFound('Sidebar section');
    }
    if (payload.name !== undefined) {
      const name = payload.name.trim().slice(0, 80);
      if (!name) {
        return RpcErrors.badRequest('Section name is required');
      }
      const clash = await this.sidebarSections.findOne({
        where: {
          organizationId: requireOrganizationId(),
          userId: payload.actorId,
          name,
        },
      });
      if (clash && clash.id !== section.id) {
        return RpcErrors.conflict('A section with that name already exists');
      }
      section.name = name;
    }
    if (payload.collapsed !== undefined) {
      section.collapsed = payload.collapsed;
    }
    if (payload.sortOrder !== undefined) {
      section.sortOrder = Math.max(0, Math.floor(payload.sortOrder));
    }
    if (payload.conversationIds !== undefined) {
      if (!Array.isArray(payload.conversationIds) || payload.conversationIds.length > 200) {
        return RpcErrors.badRequest('Invalid conversation list');
      }
      const unique = [
        ...new Set(
          payload.conversationIds
            .map((id) => String(id).trim())
            .filter((id) =>
              /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                id,
              ),
            ),
        ),
      ];
      // Ensure the actor is a member of each conversation.
      if (unique.length > 0) {
        const memberships = await this.members.count({
          where: {
            userId: payload.actorId,
            conversationId: In(unique),
            leftAt: IsNull(),
          },
        });
        if (memberships !== unique.length) {
          return RpcErrors.badRequest(
            'All conversations must be ones you belong to',
          );
        }
      }
      // Remove these IDs from other sections for this user.
      const siblings = await this.sidebarSections.find({
        where: {
          organizationId: requireOrganizationId(),
          userId: payload.actorId,
        },
      });
      for (const sibling of siblings) {
        if (sibling.id === section.id) {
          continue;
        }
        const nextIds = (sibling.conversationIds ?? []).filter(
          (id) => !unique.includes(id),
        );
        if (nextIds.length !== (sibling.conversationIds ?? []).length) {
          sibling.conversationIds = nextIds;
          await this.sidebarSections.save(sibling);
        }
      }
      section.conversationIds = unique;
    }
    const saved = await this.sidebarSections.save(section);
    return this.toSidebarSectionView(saved);
  }

  async deleteSidebarSection(
    payload: DeleteSidebarSectionPayload,
  ): Promise<{ deleted: boolean }> {
    const section = await this.sidebarSections.findOne({
      where: {
        id: payload.sectionId,
        organizationId: requireOrganizationId(),
        userId: payload.actorId,
      },
    });
    if (!section) {
      return RpcErrors.notFound('Sidebar section');
    }
    await this.sidebarSections.remove(section);
    return { deleted: true };
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
    if (payload.customEmojis !== undefined) {
      const normalized = this.normalizeCustomEmojis(payload.customEmojis);
      if (normalized === null) {
        return RpcErrors.badRequest('Invalid custom emoji list');
      }
      settings.customEmojis = normalized;
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
    await this.sidebarSections.delete({ organizationId: orgId });
    await this.messageEdits.delete({ organizationId: orgId });

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

  private async resolveSearchSenderIds(
    parsed: ParsedMessageSearch,
    gatewaySenderIds?: string[],
  ): Promise<string[]> {
    if (parsed.fromTokens.length === 0) {
      return [];
    }
    const ids = new Set<string>(gatewaySenderIds ?? []);
    for (const token of parsed.fromTokens) {
      if (isUuidToken(token)) {
        ids.add(token);
      }
    }
    return [...ids];
  }

  private async resolveSearchChannelIds(
    actorId: string,
    channelTokens: string[],
    candidateIds: string[],
  ): Promise<string[]> {
    if (channelTokens.length === 0 || candidateIds.length === 0) {
      return candidateIds;
    }
    const rows = await this.conversations.find({
      where: {
        id: In(candidateIds),
        organizationId: requireOrganizationId(),
        type: ConversationType.GROUP,
      },
      select: { id: true, name: true },
    });
    const matched = rows.filter((row) => {
      const name = (row.name ?? '')
        .trim()
        .toLowerCase()
        .replace(/^#/, '');
      return channelTokens.some(
        (token) => name === token || name.includes(token),
      );
    });
    // Ensure actor still has membership (candidates already scoped).
    void actorId;
    return matched.map((row) => row.id);
  }

  private applyAdvancedSearchFilters(
    qb: import('typeorm').SelectQueryBuilder<Message>,
    input: {
      parsed: ParsedMessageSearch;
      actorId: string;
      senderIds: string[];
    },
  ): void {
    const { parsed, actorId, senderIds } = input;

    qb.andWhere('m.deletedForEveryoneAt IS NULL')
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM message_hides mh
          WHERE mh."messageId" = m.id AND mh."userId" = :actorId
        )`,
        { actorId },
      )
      .andWhere('(m.undelivered = false OR m.senderId = :actorId)', {
        actorId,
      });

    if (senderIds.length > 0) {
      qb.andWhere('m.senderId IN (:...senderIds)', { senderIds });
    }

    if (parsed.before) {
      qb.andWhere('m.createdAt < :beforeAt', { beforeAt: parsed.before });
    }
    if (parsed.after) {
      qb.andWhere('m.createdAt >= :afterAt', { afterAt: parsed.after });
    }

    this.applyHasFilters(qb, parsed.has);

    const tsQuery = buildTsQuery(parsed.text);
    if (tsQuery) {
      qb.andWhere(
        `(
          m."searchVector" @@ to_tsquery('english', :tsQuery)
          OR m.body ILIKE :ilikePattern ESCAPE '\\'
          OR COALESCE(m."attachmentName", '') ILIKE :ilikePattern ESCAPE '\\'
        )`,
        {
          tsQuery,
          ilikePattern: `%${escapeIlikePattern(parsed.text)}%`,
        },
      );
      qb.orderBy(
        `ts_rank(m."searchVector", to_tsquery('english', :tsQuery))`,
        'DESC',
      ).addOrderBy('m.createdAt', 'DESC');
    } else {
      qb.orderBy('m.createdAt', 'DESC');
    }
  }

  private applyHasFilters(
    qb: import('typeorm').SelectQueryBuilder<Message>,
    kinds: SearchHasKind[],
  ): void {
    if (kinds.length === 0) {
      return;
    }
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    for (const kind of kinds) {
      if (kind === 'image') {
        clauses.push(
          `(m.type = :hasImageType OR m."attachmentMime" ILIKE 'image/%')`,
        );
        params.hasImageType = MessageType.IMAGE;
      } else if (kind === 'audio') {
        clauses.push(
          `(m.type = :hasAudioType OR m."attachmentMime" ILIKE 'audio/%' OR m."attachmentMime" = 'video/webm')`,
        );
        params.hasAudioType = MessageType.AUDIO;
      } else if (kind === 'link') {
        clauses.push(`m."linkPreview" IS NOT NULL`);
      } else if (kind === 'file') {
        clauses.push(
          `(
            m."attachmentUrl" IS NOT NULL AND m."attachmentUrl" <> ''
            AND COALESCE(m."attachmentMime", '') NOT ILIKE 'image/%'
            AND COALESCE(m."attachmentMime", '') NOT ILIKE 'audio/%'
            AND COALESCE(m."attachmentMime", '') <> 'video/webm'
          )`,
        );
      }
    }
    if (clauses.length > 0) {
      qb.andWhere(`(${clauses.join(' OR ')})`, params);
    }
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
      customEmojis: Array.isArray(item.customEmojis) ? item.customEmojis : [],
    };
  }

  private toSidebarSectionView(item: SidebarSection): SidebarSectionView {
    return {
      id: item.id,
      name: item.name,
      sortOrder: item.sortOrder,
      collapsed: item.collapsed,
      conversationIds: Array.isArray(item.conversationIds)
        ? item.conversationIds
        : [],
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private normalizeCustomEmojis(
    input: Array<{
      shortcode?: string;
      emoji?: string;
      imageUrl?: string | null;
    }>,
  ): Array<{
    shortcode: string;
    emoji?: string;
    imageUrl?: string | null;
  }> | null {
    if (!Array.isArray(input) || input.length > 100) {
      return null;
    }
    const seen = new Set<string>();
    const out: Array<{
      shortcode: string;
      emoji?: string;
      imageUrl?: string | null;
    }> = [];
    for (const row of input) {
      const shortcode = String(row?.shortcode ?? '')
        .trim()
        .toLowerCase()
        .replace(/^:+|:+$/g, '');
      const emoji = String(row?.emoji ?? '').trim();
      const imageUrl = row?.imageUrl?.trim() || null;
      if (!/^[a-z0-9_+-]{1,32}$/.test(shortcode)) {
        return null;
      }
      const hasGlyph =
        Boolean(emoji) &&
        isValidReactionEmoji(emoji) &&
        !/^:/.test(emoji);
      const hasImage =
        Boolean(imageUrl) &&
        (imageUrl!.startsWith('/uploads/') ||
          /^https?:\/\//i.test(imageUrl!)) &&
        imageUrl!.length <= 500;
      if (!hasGlyph && !hasImage) {
        return null;
      }
      if (seen.has(shortcode)) {
        return null;
      }
      seen.add(shortcode);
      out.push({
        shortcode,
        ...(hasGlyph ? { emoji } : {}),
        ...(hasImage ? { imageUrl } : { imageUrl: null }),
      });
    }
    return out;
  }

  private async resolveReactionEmoji(raw: string): Promise<string | null> {
    const trimmed = raw.trim();
    if (!isValidReactionEmoji(trimmed)) {
      return null;
    }
    const shortMatch = /^:([a-z0-9_+-]{1,32}):$/i.exec(trimmed);
    if (!shortMatch) {
      return trimmed;
    }
    const settings = await this.workspaceSettings.findOne({
      where: { organizationId: requireOrganizationId() },
    });
    const code = shortMatch[1].toLowerCase();
    const found = (settings?.customEmojis ?? []).find(
      (row) => row.shortcode.toLowerCase() === code,
    );
    if (!found) {
      return null;
    }
    if (found.emoji) {
      return found.emoji;
    }
    if (found.imageUrl) {
      return `:${found.shortcode}:`;
    }
    return null;
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

  private async loadThreadReplyCounts(
    rootIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (rootIds.length === 0) {
      return counts;
    }

    const rows = await this.messages
      .createQueryBuilder('m')
      .select('m.threadRootId', 'threadRootId')
      .addSelect('COUNT(*)', 'count')
      .where('m.threadRootId IN (:...rootIds)', { rootIds })
      .andWhere('m.organizationId = :organizationId', {
        organizationId: requireOrganizationId(),
      })
      .groupBy('m.threadRootId')
      .getRawMany<{ threadRootId: string; count: string }>();

    for (const row of rows) {
      counts.set(row.threadRootId, Number(row.count));
    }
    return counts;
  }

  private toChannelInviteView(
    invite: ChannelInvite,
    rawToken: string | null,
  ): ChannelInviteView {
    return {
      id: invite.id,
      conversationId: invite.conversationId,
      token: rawToken,
      // Frontend route recipients open in the browser (API accept is POST).
      inviteUrl: rawToken ? `/channel-invite/${rawToken}` : null,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
      maxUses: invite.maxUses,
      useCount: invite.useCount,
      revokedAt: invite.revokedAt?.toISOString() ?? null,
      createdBy: invite.createdBy,
      createdAt: invite.createdAt.toISOString(),
    };
  }

  private toIncomingWebhookView(
    webhook: IncomingWebhook,
    rawToken: string | null,
  ): IncomingWebhookView {
    return {
      id: webhook.id,
      conversationId: webhook.conversationId,
      name: webhook.name,
      defaultUsername: webhook.defaultUsername,
      defaultIconUrl: webhook.defaultIconUrl,
      token: rawToken,
      webhookUrl: rawToken ? `/hooks/incoming/${rawToken}` : null,
      createdBy: webhook.createdBy,
      revokedAt: webhook.revokedAt?.toISOString() ?? null,
      lastUsedAt: webhook.lastUsedAt?.toISOString() ?? null,
      createdAt: webhook.createdAt.toISOString(),
    };
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
      visibility: conversation.visibility ?? 'private',
      announceOnly: Boolean(conversation.announceOnly),
      topic: conversation.topic ?? null,
      description: conversation.description ?? null,
      bookmarks: Array.isArray(conversation.bookmarks)
        ? conversation.bookmarks
        : [],
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
    replyCount = 0,
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
      threadRootId: message.threadRootId ?? null,
      replyCount,
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
      botUsername: deletedForEveryone ? null : (message.botUsername ?? null),
      botIconUrl: deletedForEveryone ? null : (message.botIconUrl ?? null),
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

  private toReminderView(
    item: MessageReminder,
    bodySnippet?: string,
    conversationName?: string | null,
    conversationType?: ConversationType,
  ): MessageReminderView {
    return {
      id: item.id,
      conversationId: item.conversationId,
      messageId: item.messageId,
      remindAt: item.remindAt.toISOString(),
      status: item.status,
      notifiedAt: item.notifiedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      ...(bodySnippet !== undefined
        ? { bodySnippet: bodySnippet.slice(0, 120) }
        : {}),
      ...(conversationName !== undefined
        ? { conversationName }
        : {}),
      ...(conversationType !== undefined
        ? { conversationType }
        : {}),
    };
  }
}
