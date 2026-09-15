import {
  ConversationMemberRole,
  ConversationType,
  MessageType,
  PresenceStatus,
} from '@app/common';

export const CHAT_PATTERNS = {
  CREATE_PRIVATE: 'chat.create_private',
  CREATE_GROUP: 'chat.create_group',
  LIST_CONVERSATIONS: 'chat.list_conversations',
  GET_CONVERSATION: 'chat.get_conversation',
  LIST_MESSAGES: 'chat.list_messages',
  SEARCH_MESSAGES: 'chat.search_messages',
  SEARCH_GLOBAL: 'chat.search_global',
  LIST_MEDIA: 'chat.list_media',
  GET_MESSAGE: 'chat.get_message',
  SEND_MESSAGE: 'chat.send_message',
  EDIT_MESSAGE: 'chat.edit_message',
  LIST_MESSAGE_EDITS: 'chat.list_message_edits',
  REACT_MESSAGE: 'chat.react_message',
  PIN_MESSAGE: 'chat.pin_message',
  LIST_PINNED_MESSAGES: 'chat.list_pinned_messages',
  CREATE_POLL: 'chat.create_poll',
  VOTE_POLL: 'chat.vote_poll',
  SAVE_BOOKMARK: 'chat.save_bookmark',
  REMOVE_BOOKMARK: 'chat.remove_bookmark',
  LIST_BOOKMARKS: 'chat.list_bookmarks',
  SCHEDULE_MESSAGE: 'chat.schedule_message',
  LIST_SCHEDULED_MESSAGES: 'chat.list_scheduled_messages',
  CANCEL_SCHEDULED_MESSAGE: 'chat.cancel_scheduled_message',
  DISPATCH_DUE_SCHEDULED: 'chat.dispatch_due_scheduled',
  UPSERT_DRAFT: 'chat.upsert_draft',
  GET_DRAFT: 'chat.get_draft',
  CLEAR_DRAFT: 'chat.clear_draft',
  CREATE_REMINDER: 'chat.create_reminder',
  LIST_REMINDERS: 'chat.list_reminders',
  CANCEL_REMINDER: 'chat.cancel_reminder',
  DISPATCH_DUE_REMINDERS: 'chat.dispatch_due_reminders',
  FORWARD_MESSAGE: 'chat.forward_message',
  MARK_SEEN: 'chat.mark_seen',
  MUTE_CONVERSATION: 'chat.mute_conversation',
  PIN_CONVERSATION: 'chat.pin_conversation',
  SET_DISAPPEARING: 'chat.set_disappearing',
  EXPIRE_DUE_MESSAGES: 'chat.expire_due_messages',
  DELETE_MESSAGE: 'chat.delete_message',
  ADD_MEMBERS: 'chat.add_members',
  REMOVE_MEMBER: 'chat.remove_member',
  SET_MEMBER_ROLE: 'chat.set_member_role',
  LEAVE: 'chat.leave',
  UPDATE_GROUP: 'chat.update_group',
  DELETE_GROUP: 'chat.delete_group',
  BLOCK_USER: 'chat.block_user',
  UNBLOCK_USER: 'chat.unblock_user',
  LIST_BLOCKS: 'chat.list_blocks',
  PREPARE_VOICE_CALL: 'chat.prepare_voice_call',
  GET_ANALYTICS: 'chat.get_analytics',
  LIST_AUDIT: 'chat.list_audit',
  LOG_AUDIT: 'chat.log_audit',
  GET_WORKSPACE: 'chat.get_workspace',
  UPDATE_WORKSPACE: 'chat.update_workspace',
  ENSURE_GENERAL_MEMBER: 'chat.ensure_general_member',
  PURGE_ORGANIZATION: 'chat.purge_organization',
  LIST_THREAD_REPLIES: 'chat.list_thread_replies',
  LIST_MY_THREADS: 'chat.list_my_threads',
  FOLLOW_THREAD: 'chat.follow_thread',
  UNFOLLOW_THREAD: 'chat.unfollow_thread',
  MARK_THREAD_READ: 'chat.mark_thread_read',
  LIST_PUBLIC_CHANNELS: 'chat.list_public_channels',
  JOIN_CHANNEL: 'chat.join_channel',
  CREATE_CHANNEL_INVITE: 'chat.create_channel_invite',
  ACCEPT_CHANNEL_INVITE: 'chat.accept_channel_invite',
  REVOKE_CHANNEL_INVITE: 'chat.revoke_channel_invite',
  LIST_CHANNEL_INVITES: 'chat.list_channel_invites',
  ADD_CHANNEL_BOOKMARK: 'chat.add_channel_bookmark',
  REMOVE_CHANNEL_BOOKMARK: 'chat.remove_channel_bookmark',
  LIST_SIDEBAR_SECTIONS: 'chat.list_sidebar_sections',
  CREATE_SIDEBAR_SECTION: 'chat.create_sidebar_section',
  UPDATE_SIDEBAR_SECTION: 'chat.update_sidebar_section',
  DELETE_SIDEBAR_SECTION: 'chat.delete_sidebar_section',
  CREATE_INCOMING_WEBHOOK: 'chat.create_incoming_webhook',
  LIST_INCOMING_WEBHOOKS: 'chat.list_incoming_webhooks',
  REVOKE_INCOMING_WEBHOOK: 'chat.revoke_incoming_webhook',
  POST_INCOMING_WEBHOOK: 'chat.post_incoming_webhook',
  CREATE_SLASH_COMMAND: 'chat.create_slash_command',
  LIST_SLASH_COMMANDS: 'chat.list_slash_commands',
  REVOKE_SLASH_COMMAND: 'chat.revoke_slash_command',
  INVOKE_SLASH_COMMAND: 'chat.invoke_slash_command',
  LIST_USER_GROUPS: 'chat.list_user_groups',
  CREATE_USER_GROUP: 'chat.create_user_group',
  UPDATE_USER_GROUP: 'chat.update_user_group',
  DELETE_USER_GROUP: 'chat.delete_user_group',
} as const;

export interface CreatePrivateChatPayload {
  actorId: string;
  otherUserId: string;
}

export interface CreateGroupChatPayload {
  actorId: string;
  name: string;
  memberIds: string[];
  visibility?: 'public' | 'private';
  announceOnly?: boolean;
}

export interface ListConversationsPayload {
  actorId: string;
  page: number;
  limit: number;
}

export interface ConversationActorPayload {
  actorId: string;
  conversationId: string;
}

export interface ListMessagesPayload extends ConversationActorPayload {
  page: number;
  limit: number;
  /** When true (default), exclude thread replies from the main timeline */
  excludeThreadReplies?: boolean;
}

export interface ListThreadRepliesPayload extends ConversationActorPayload {
  threadRootId: string;
  page: number;
  limit: number;
}

export interface ListMyThreadsPayload {
  actorId: string;
  page: number;
  limit: number;
}

export interface FollowThreadPayload extends ConversationActorPayload {
  threadRootId: string;
}

export interface UnfollowThreadPayload extends ConversationActorPayload {
  threadRootId: string;
}

export interface MarkThreadReadPayload extends ConversationActorPayload {
  threadRootId: string;
}

export interface ThreadSummaryView {
  conversationId: string;
  conversationName: string | null;
  conversationType: ConversationType;
  root: MessageView;
  latestReply: MessageView | null;
  replyCount: number;
  lastReplyAt: string;
  followed: boolean;
  unreadCount: number;
  hasUnread: boolean;
}

export interface SearchMessagesPayload extends ConversationActorPayload {
  query: string;
  page: number;
  limit: number;
  /** Resolved from: operators (gateway). */
  senderIds?: string[];
}

export interface GlobalSearchMessagesPayload {
  actorId: string;
  query: string;
  page: number;
  limit: number;
  /** Resolved from: operators (gateway). */
  senderIds?: string[];
}

export interface GlobalSearchConversationView {
  id: string;
  type: ConversationType;
  name: string | null;
  members: Array<{ userId: string }>;
}

export interface GlobalSearchHitView {
  message: MessageView;
  conversation: GlobalSearchConversationView;
}

export type MediaKindFilter = 'all' | 'image' | 'file' | 'audio';

export interface ListMediaPayload extends ConversationActorPayload {
  page: number;
  limit: number;
  kind?: MediaKindFilter;
}

export interface GetMessagePayload extends ConversationActorPayload {
  messageId: string;
}

export interface SendMessagePayload extends ConversationActorPayload {
  body?: string;
  type?: MessageType;
  replyToMessageId?: string;
  /** Post into a Slack-style thread under this root message */
  threadRootId?: string;
  attachmentUrl?: string;
  attachmentMime?: string;
  attachmentName?: string;
  attachmentSize?: number;
  mentionUserIds?: string[];
  /**
   * Online (socket-connected) member ids for @here expansion.
   * Provided by the gateway from presence; ignored for other mentions.
   */
  onlineUserIds?: string[];
  /** When replying in a thread, also post a copy to the main channel */
  alsoSendToChannel?: boolean;
  linkPreview?: LinkPreviewView | null;
  /** Only the call gateway may set this when writing CALL history. */
  systemCall?: boolean;
}

export interface SendMessageResult extends MessageView {
  recipientIds: string[];
  /** Members who muted this conversation (for push filtering). */
  mutedRecipientIds?: string[];
  /**
   * When set (e.g. thread replies), push only these users.
   * Socket broadcast still uses recipientIds.
   */
  pushRecipientIds?: string[];
  /** Optional channel copy when alsoSendToChannel was requested */
  channelBroadcast?: MessageView;
}

export interface EditMessagePayload extends ConversationActorPayload {
  messageId: string;
  body: string;
}

export interface ListMessageEditsPayload extends ConversationActorPayload {
  messageId: string;
}

export interface MessageEditVersionView {
  id: string;
  body: string;
  editorId: string;
  createdAt: string;
}

export interface MessageEditHistoryView {
  messageId: string;
  currentBody: string;
  currentEditedAt: string | null;
  versions: MessageEditVersionView[];
}

export interface ReactMessagePayload extends ConversationActorPayload {
  messageId: string;
  emoji: string;
}

export interface PinMessagePayload extends ConversationActorPayload {
  messageId: string;
  pinned: boolean;
}

export interface ScheduleMessagePayload extends ConversationActorPayload {
  body?: string;
  type?: MessageType;
  replyToMessageId?: string;
  attachmentUrl?: string;
  attachmentMime?: string;
  attachmentName?: string;
  attachmentSize?: number;
  mentionUserIds?: string[];
  linkPreview?: LinkPreviewView | null;
  scheduledFor: string;
}

export interface CancelScheduledMessagePayload extends ConversationActorPayload {
  scheduledMessageId: string;
}

export type ScheduledMessageStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'cancelled'
  | 'failed';

export interface ScheduledMessageView {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  type: MessageType;
  replyToMessageId: string | null;
  attachment: MessageAttachmentView | null;
  mentions: string[];
  linkPreview: LinkPreviewView | null;
  scheduledFor: string;
  status: ScheduledMessageStatus;
  sentMessageId: string | null;
  error: string | null;
  createdAt: string;
}

export interface UpsertDraftPayload extends ConversationActorPayload {
  body: string;
}

export interface DraftView {
  conversationId: string;
  body: string;
  updatedAt: string;
}

export interface CreateReminderPayload extends ConversationActorPayload {
  messageId: string;
  remindAt: string;
}

export interface CancelReminderPayload {
  actorId: string;
  reminderId: string;
}

export type MessageReminderStatus = 'pending' | 'sent' | 'cancelled';

export interface MessageReminderView {
  id: string;
  conversationId: string;
  messageId: string;
  remindAt: string;
  status: MessageReminderStatus;
  notifiedAt: string | null;
  createdAt: string;
  bodySnippet?: string;
  conversationName?: string | null;
  conversationType?: ConversationType;
}

export interface ReminderDispatchResult {
  id: string;
  organizationId: string;
  userId: string;
  conversationId: string;
  messageId: string;
  bodySnippet: string;
  remindAt: string;
}

export interface ForwardMessagePayload {
  actorId: string;
  messageId: string;
  fromConversationId: string;
  toConversationId: string;
}

export interface MarkSeenPayload extends ConversationActorPayload {
  messageId?: string;
}

export interface MuteConversationPayload extends ConversationActorPayload {
  muted: boolean;
}

export interface PinConversationPayload extends ConversationActorPayload {
  pinned: boolean;
}

export interface SetDisappearingPayload extends ConversationActorPayload {
  /** 0 = off. Allowed: 0, 30, 60, 3600, 86400, 604800, 7776000 */
  durationSeconds: number;
}

export interface DeleteMessagePayload extends ConversationActorPayload {
  messageId: string;
  forEveryone?: boolean;
}

export interface DeleteMessageResult {
  message: MessageView;
  forEveryone: boolean;
  recipientIds: string[];
  /** Public URL of attachment removed on delete-for-everyone (for storage cleanup) */
  removedAttachmentUrl?: string | null;
}

export interface AddMembersPayload extends ConversationActorPayload {
  memberIds: string[];
}

export interface EnsureGeneralMemberPayload {
  userId: string;
}

export interface RemoveMemberPayload extends ConversationActorPayload {
  memberId: string;
}

export interface SetMemberRolePayload extends ConversationActorPayload {
  memberId: string;
  role: ConversationMemberRole.ADMIN | ConversationMemberRole.MEMBER;
}

export interface UpdateGroupPayload extends ConversationActorPayload {
  name?: string;
  visibility?: 'public' | 'private';
  announceOnly?: boolean;
  topic?: string | null;
  description?: string | null;
}

export interface AddChannelBookmarkPayload extends ConversationActorPayload {
  title: string;
  url: string;
}

export interface RemoveChannelBookmarkPayload extends ConversationActorPayload {
  bookmarkId: string;
}

export type ChannelBookmarkView = {
  id: string;
  title: string;
  url: string;
  createdBy: string;
  createdAt: string;
};

export interface JoinChannelPayload {
  actorId: string;
  conversationId: string;
}

export interface CreateChannelInvitePayload extends ConversationActorPayload {
  expiresInHours?: number;
  maxUses?: number;
}

export interface AcceptChannelInvitePayload {
  actorId: string;
  token: string;
}

export interface RevokeChannelInvitePayload extends ConversationActorPayload {
  inviteId: string;
}

export interface ChannelInviteView {
  id: string;
  conversationId: string;
  token: string | null;
  inviteUrl: string | null;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface BlockUserPayload {
  actorId: string;
  userId: string;
}

export interface ConversationMemberView {
  userId: string;
  role: ConversationMemberRole;
  joinedAt: string;
  lastReadAt: string | null;
  muted: boolean;
  status: PresenceStatus;
  lastSeenAt: string | null;
  customStatus?: string | null;
}

export interface MessageReplyView {
  id: string;
  senderId: string;
  body: string;
  type?: string;
  deletedForEveryone: boolean;
}

export interface MessageReactionView {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

export interface MessageAttachmentView {
  url: string;
  mime: string;
  name: string;
  size: number;
}

export interface LinkPreviewView {
  url: string;
  title: string;
  description: string;
  image: string | null;
}

export interface PollOptionView {
  id: string;
  text: string;
  voteCount: number;
  votedByMe: boolean;
}

export interface PollView {
  question: string;
  options: PollOptionView[];
  allowMultiple: boolean;
  closed: boolean;
  totalVotes: number;
}

export interface CreatePollPayload extends ConversationActorPayload {
  question: string;
  options: string[];
  allowMultiple?: boolean;
}

export interface VotePollPayload extends ConversationActorPayload {
  messageId: string;
  optionId: string;
}

export interface SaveBookmarkPayload {
  actorId: string;
  messageId: string;
}

export interface RemoveBookmarkPayload {
  actorId: string;
  messageId: string;
}

export interface ListBookmarksPayload {
  actorId: string;
  page: number;
  limit: number;
  conversationId?: string;
}

export interface BookmarkView {
  id: string;
  conversationId: string;
  messageId: string;
  createdAt: string;
  message: MessageView;
  conversationName: string | null;
  conversationType: ConversationType;
}

export interface MessageView {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  type: MessageType;
  replyTo: MessageReplyView | null;
  threadRootId: string | null;
  replyCount: number;
  attachment: MessageAttachmentView | null;
  mentions: string[];
  linkPreview: LinkPreviewView | null;
  poll: PollView | null;
  reactions: MessageReactionView[];
  editedAt: string | null;
  pinned: boolean;
  pinnedAt: string | null;
  pinnedByUserId: string | null;
  forwarded: boolean;
  deletedForEveryone: boolean;
  seenBy: string[];
  /** Sent while peer was blocked — single tick, hidden from recipient. */
  undelivered: boolean;
  expiresAt: string | null;
  /** Integration/bot display name when posted via incoming webhook. */
  botUsername: string | null;
  botIconUrl: string | null;
  createdAt: string;
}

export interface ConversationView {
  id: string;
  type: ConversationType;
  name: string | null;
  createdBy: string;
  visibility: 'public' | 'private';
  announceOnly: boolean;
  topic: string | null;
  description: string | null;
  bookmarks: ChannelBookmarkView[];
  lastMessageAt: string | null;
  lastMessage: MessageView | null;
  lastReadAt: string | null;
  muted: boolean;
  pinned: boolean;
  disappearingDurationSeconds: number;
  /** Private chat: current user blocked the peer. */
  blockedByMe: boolean;
  /** Private chat: peer blocked the current user. */
  blockedMe: boolean;
  unreadCount: number;
  /** True when an unread message @mentions the current user. */
  hasUnreadMention: boolean;
  /** Oldest unread message that @mentions the current user (for jump). */
  firstUnreadMentionMessageId: string | null;
  members: ConversationMemberView[];
  createdAt: string;
  updatedAt: string;
}

export interface SeenResultView {
  conversationId: string;
  userId: string;
  lastReadAt: string;
  messageId: string | null;
  recipientIds: string[];
}

export interface PresenceView {
  userId: string;
  status: PresenceStatus;
  lastSeenAt: string | null;
  customStatus: string | null;
}

export interface BlockView {
  userId: string;
  createdAt: string;
}

export interface PrepareVoiceCallResult {
  conversationId: string;
  kind: 'private' | 'group';
  /** Other members who can be invited (excludes actor; excludes blocked for private). */
  peerIds: string[];
  /** Full member list including actor. */
  memberIds: string[];
}

export interface ChatAnalyticsView {
  totalConversations: number;
  totalMessages: number;
  messagesToday: number;
  messagesThisWeek: number;
  activeConversationsToday: number;
  messagesByDay: { date: string; count: number }[];
  topConversations: { conversationId: string; name: string | null; type: string; messageCount: number }[];
}

export interface AuditEventView {
  id: string;
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface ListAuditPayload {
  actorId: string;
  page: number;
  limit: number;
}

export interface LogAuditPayload {
  actorId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
}

export interface WorkspaceCustomEmoji {
  shortcode: string;
  /** Unicode glyph (optional when imageUrl is set). */
  emoji?: string;
  /** Uploaded image URL for Slack-style custom emoji. */
  imageUrl?: string | null;
}

export interface WorkspaceSettingsView {
  appName: string;
  tagline: string;
  primaryColor: string;
  logoUrl: string | null;
  customEmojis: WorkspaceCustomEmoji[];
}

export interface UpdateWorkspacePayload {
  actorId: string;
  appName?: string;
  tagline?: string;
  primaryColor?: string;
  logoUrl?: string | null;
  customEmojis?: WorkspaceCustomEmoji[];
}

export interface PurgeOrganizationChatPayload {
  organizationId: string;
  actorId: string;
}

export interface SidebarSectionView {
  id: string;
  name: string;
  sortOrder: number;
  collapsed: boolean;
  conversationIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateSidebarSectionPayload {
  actorId: string;
  name: string;
}

export interface UpdateSidebarSectionPayload {
  actorId: string;
  sectionId: string;
  name?: string;
  collapsed?: boolean;
  sortOrder?: number;
  conversationIds?: string[];
}

export interface DeleteSidebarSectionPayload {
  actorId: string;
  sectionId: string;
}

export interface IncomingWebhookView {
  id: string;
  conversationId: string;
  name: string;
  defaultUsername: string;
  defaultIconUrl: string | null;
  /** Present only on create — plaintext token / URL shown once. */
  token?: string | null;
  webhookUrl?: string | null;
  createdBy: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreateIncomingWebhookPayload {
  actorId: string;
  conversationId: string;
  name: string;
  defaultUsername?: string;
  defaultIconUrl?: string | null;
}

export interface ListIncomingWebhooksPayload {
  actorId: string;
  conversationId: string;
}

export interface RevokeIncomingWebhookPayload {
  actorId: string;
  conversationId: string;
  webhookId: string;
}

export interface PostIncomingWebhookPayload {
  token: string;
  text: string;
  username?: string;
}

export interface SlashCommandView {
  id: string;
  name: string;
  description: string;
  responseTemplate: string;
  /** True for built-in commands that cannot be revoked. */
  builtin: boolean;
  createdBy: string | null;
  revokedAt: string | null;
  createdAt: string | null;
}

export interface CreateSlashCommandPayload {
  actorId: string;
  name: string;
  description: string;
  responseTemplate: string;
}

export interface ListSlashCommandsPayload {
  actorId: string;
}

export interface RevokeSlashCommandPayload {
  actorId: string;
  commandId: string;
}

export interface InvokeSlashCommandPayload {
  actorId: string;
  conversationId: string;
  /** Full composer text starting with /command */
  raw: string;
}

export interface InvokeSlashCommandResult {
  kind: 'message' | 'ephemeral' | 'status';
  message?: SendMessageResult;
  ephemeral?: string;
  /** Applied by gateway via PresenceService. */
  customStatus?: string | null;
}

export interface UserGroupView {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  memberIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListUserGroupsPayload {
  actorId: string;
}

export interface CreateUserGroupPayload {
  actorId: string;
  name: string;
  displayName: string;
  description?: string | null;
  memberIds: string[];
}

export interface UpdateUserGroupPayload {
  actorId: string;
  groupId: string;
  displayName?: string;
  description?: string | null;
  memberIds?: string[];
}

export interface DeleteUserGroupPayload {
  actorId: string;
  groupId: string;
}
