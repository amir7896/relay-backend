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
  LIST_MY_DRAFTS: 'chat.list_my_drafts',
  CREATE_REMINDER: 'chat.create_reminder',
  LIST_REMINDERS: 'chat.list_reminders',
  CANCEL_REMINDER: 'chat.cancel_reminder',
  COMPLETE_REMINDER: 'chat.complete_reminder',
  CLEAR_COMPLETED_REMINDERS: 'chat.clear_completed_reminders',
  DISPATCH_DUE_REMINDERS: 'chat.dispatch_due_reminders',
  FORWARD_MESSAGE: 'chat.forward_message',
  MARK_SEEN: 'chat.mark_seen',
  MARK_UNREAD: 'chat.mark_unread',
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
  /** Add a user to a channel without requiring channel-admin actor (invite accept). */
  ENSURE_CHANNEL_MEMBER: 'chat.ensure_channel_member',
  PURGE_ORGANIZATION: 'chat.purge_organization',
  LIST_THREAD_REPLIES: 'chat.list_thread_replies',
  LIST_MY_THREADS: 'chat.list_my_threads',
  LIST_MY_MENTIONS: 'chat.list_my_mentions',
  FOLLOW_THREAD: 'chat.follow_thread',
  UNFOLLOW_THREAD: 'chat.unfollow_thread',
  MARK_THREAD_READ: 'chat.mark_thread_read',
  LIST_PUBLIC_CHANNELS: 'chat.list_public_channels',
  JOIN_CHANNEL: 'chat.join_channel',
  LIST_CONVERSATION_MEMBERS: 'chat.list_conversation_members',
  CREATE_CHANNEL_INVITE: 'chat.create_channel_invite',
  PREVIEW_CHANNEL_INVITE: 'chat.preview_channel_invite',
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
  CREATE_OUTGOING_WEBHOOK: 'chat.create_outgoing_webhook',
  LIST_OUTGOING_WEBHOOKS: 'chat.list_outgoing_webhooks',
  REVOKE_OUTGOING_WEBHOOK: 'chat.revoke_outgoing_webhook',
  DISPATCH_OUTGOING_WEBHOOKS: 'chat.dispatch_outgoing_webhooks',
  CREATE_SLASH_COMMAND: 'chat.create_slash_command',
  LIST_SLASH_COMMANDS: 'chat.list_slash_commands',
  REVOKE_SLASH_COMMAND: 'chat.revoke_slash_command',
  INVOKE_SLASH_COMMAND: 'chat.invoke_slash_command',
  LIST_USER_GROUPS: 'chat.list_user_groups',
  CREATE_USER_GROUP: 'chat.create_user_group',
  UPDATE_USER_GROUP: 'chat.update_user_group',
  DELETE_USER_GROUP: 'chat.delete_user_group',
  GET_CANVAS: 'chat.get_canvas',
  PUT_CANVAS: 'chat.put_canvas',
  LIST_CHANNEL_LISTS: 'chat.list_channel_lists',
  GET_CHANNEL_LIST: 'chat.get_channel_list',
  CREATE_CHANNEL_LIST: 'chat.create_channel_list',
  UPDATE_CHANNEL_LIST: 'chat.update_channel_list',
  DELETE_CHANNEL_LIST: 'chat.delete_channel_list',
  CREATE_CHANNEL_LIST_ITEM: 'chat.create_channel_list_item',
  UPDATE_CHANNEL_LIST_ITEM: 'chat.update_channel_list_item',
  DELETE_CHANNEL_LIST_ITEM: 'chat.delete_channel_list_item',
  LIST_CLIPS: 'chat.list_clips',
  CREATE_CLIP: 'chat.create_clip',
  DELETE_CLIP: 'chat.delete_clip',
  GET_HUDDLE: 'chat.get_huddle',
  START_HUDDLE: 'chat.start_huddle',
  JOIN_HUDDLE: 'chat.join_huddle',
  LEAVE_HUDDLE: 'chat.leave_huddle',
  END_HUDDLE: 'chat.end_huddle',
  LIST_WORKFLOWS: 'chat.list_workflows',
  CREATE_WORKFLOW: 'chat.create_workflow',
  UPDATE_WORKFLOW: 'chat.update_workflow',
  DELETE_WORKFLOW: 'chat.delete_workflow',
  RUN_WORKFLOW: 'chat.run_workflow',
  EVALUATE_WORKFLOWS: 'chat.evaluate_workflows',
  CREATE_SHARED_INVITE: 'chat.create_shared_invite',
  GET_SHARED_INFO: 'chat.get_shared_info',
  ACCEPT_SHARED_INVITE: 'chat.accept_shared_invite',
  ACCEPT_WORKSPACE_SHARE: 'chat.accept_workspace_share',
  DISCONNECT_SHARED_CHANNEL: 'chat.disconnect_shared_channel',
  RESOLVE_CONNECT_CONVERSATION: 'chat.resolve_connect_conversation',
  PREVIEW_SHARED_INVITE: 'chat.preview_shared_invite',
  REVOKE_SHARED_INVITE: 'chat.revoke_shared_invite',
  MARK_SHARED_INVITE_ACCEPTED: 'chat.mark_shared_invite_accepted',
  BIND_SHARED_INVITE_TOKEN: 'chat.bind_shared_invite_token',
  LIST_APP_CATALOG: 'chat.list_app_catalog',
  INSTALL_APP: 'chat.install_app',
  UNINSTALL_APP: 'chat.uninstall_app',
  LIST_INSTALLED_APPS: 'chat.list_installed_apps',
  UPSERT_APP_OAUTH: 'chat.upsert_app_oauth',
  GET_APP_OAUTH_STATUS: 'chat.get_app_oauth_status',
  DISCONNECT_APP_OAUTH: 'chat.disconnect_app_oauth',
  UNFURL_APP_LINK: 'chat.unfurl_app_link',
  CREATE_APP_ISSUE_FROM_MESSAGE: 'chat.create_app_issue_from_message',
  CREATE_ZOOM_MEETING: 'chat.create_zoom_meeting',
  INGEST_APP_EVENT: 'chat.ingest_app_event',
  LIST_APP_PROJECTS: 'chat.list_app_projects',
  DISPATCH_DUE_STANDUPS: 'chat.dispatch_due_standups',
  RUN_STANDUP_NOW: 'chat.run_standup_now',
  COLLECT_STANDUP_REPLY: 'chat.collect_standup_reply',
  SUMMARIZE_STANDUP: 'chat.summarize_standup',
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

export interface ListMyMentionsPayload {
  actorId: string;
  page: number;
  limit: number;
  /** When true, only mentions newer than the member's lastReadAt. */
  unreadOnly?: boolean;
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

export interface MentionActivityView {
  conversationId: string;
  conversationName: string | null;
  conversationType: ConversationType;
  message: MessageView;
  unread: boolean;
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

export interface ConnectMessageFanout {
  conversationId: string;
  recipientIds: string[];
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
  /**
   * Partner-stub mirrors for true multi-org Connect.
   * Gateway re-emits the same message with each stub conversationId.
   */
  connectFanouts?: ConnectMessageFanout[];
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

export interface ListMyDraftsPayload {
  actorId: string;
  page: number;
  limit: number;
}

export interface DraftInboxView {
  conversationId: string;
  conversationName: string | null;
  conversationType: ConversationType;
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

export type MessageReminderStatus =
  | 'pending'
  | 'sent'
  | 'cancelled'
  | 'completed';

export type ListRemindersScope = 'open' | 'done' | 'all';

export interface ListRemindersPayload {
  actorId: string;
  page?: number;
  limit?: number;
  /** open=pending (default), done=completed+sent, all=open+done */
  scope?: ListRemindersScope;
}

export interface CompleteReminderPayload {
  actorId: string;
  reminderId: string;
}

export interface ClearCompletedRemindersPayload {
  actorId: string;
}

export interface MessageReminderView {
  id: string;
  conversationId: string;
  messageId: string;
  remindAt: string;
  status: MessageReminderStatus;
  notifiedAt: string | null;
  completedAt?: string | null;
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

/** Slack-style: rewind read cursor so this message (and later) are unread. */
export interface MarkUnreadPayload extends ConversationActorPayload {
  messageId: string;
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

export interface ListConversationMembersPayload {
  actorId: string;
  conversationId: string;
  page?: number;
  limit?: number;
  search?: string;
}

export interface CreateChannelInvitePayload extends ConversationActorPayload {
  expiresInHours?: number;
  maxUses?: number;
}

export interface PreviewChannelInvitePayload {
  token: string;
}

export interface ChannelInvitePreviewView {
  valid: boolean;
  conversationId: string | null;
  conversationName: string | null;
  organizationId: string | null;
  expiresAt: string | null;
  message?: string;
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
  conversationName?: string | null;
  token: string | null;
  inviteUrl: string | null;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
  emailSent?: boolean;
  debugInviteUrl?: string;
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
  /** Slack Connect: channel is shared with external collaborators. */
  isShared?: boolean;
  sharedExternalLabel?: string | null;
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
  page?: number;
  limit?: number;
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

export interface OutgoingWebhookView {
  id: string;
  conversationId: string;
  name: string;
  targetUrl: string;
  excludeBots: boolean;
  /** Present only on create — signing secret shown once. */
  signingSecret?: string | null;
  createdBy: string;
  revokedAt: string | null;
  lastDeliveredAt: string | null;
  failureCount: number;
  createdAt: string;
}

export interface CreateOutgoingWebhookPayload {
  actorId: string;
  conversationId: string;
  name: string;
  targetUrl: string;
  excludeBots?: boolean;
}

export interface ListOutgoingWebhooksPayload {
  actorId: string;
  conversationId: string;
  page?: number;
  limit?: number;
}

export interface RevokeOutgoingWebhookPayload {
  actorId: string;
  conversationId: string;
  webhookId: string;
}

export interface DispatchOutgoingWebhooksPayload {
  conversationId: string;
  event: 'message.created';
  message: {
    id: string;
    body: string | null;
    senderId: string;
    type: string;
    createdAt: string;
    botUsername?: string | null;
  };
}

export interface SlashCommandView {
  id: string;
  name: string;
  description: string;
  responseTemplate: string;
  responseMode: 'in_channel' | 'ephemeral';
  requestUrl: string | null;
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
  responseTemplate?: string;
  responseMode?: 'in_channel' | 'ephemeral';
  requestUrl?: string | null;
}

export interface ListSlashCommandsPayload {
  actorId: string;
  page?: number;
  limit?: number;
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
  handle: string;
  name: string;
  description: string | null;
  memberIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListUserGroupsPayload {
  actorId: string;
  page?: number;
  limit?: number;
}

export interface CreateUserGroupPayload {
  actorId: string;
  handle: string;
  name: string;
  description?: string | null;
  memberIds: string[];
}

export interface UpdateUserGroupPayload {
  actorId: string;
  groupId: string;
  handle?: string;
  name?: string;
  description?: string | null;
  memberIds?: string[];
}

export interface DeleteUserGroupPayload {
  actorId: string;
  groupId: string;
}

export interface ChannelCanvasView { id: string; organizationId: string; conversationId: string; title: string; body: string; updatedBy: string; createdAt: string; updatedAt: string }
export interface PutChannelCanvasPayload extends ConversationActorPayload { title?: string; body?: string }
export type ChannelListItemStatus = 'todo' | 'doing' | 'done';
export interface ChannelListItemView { id: string; listId: string; title: string; status: ChannelListItemStatus; assigneeId: string | null; sortOrder: number; createdAt: string }
export interface ChannelListView { id: string; organizationId: string; conversationId: string; name: string; createdBy: string; createdAt: string; items: ChannelListItemView[] }
export interface CreateChannelListPayload extends ConversationActorPayload { name: string }
export interface UpdateChannelListPayload extends ConversationActorPayload { listId: string; name?: string }
export interface DeleteChannelListPayload extends ConversationActorPayload { listId: string }
export interface CreateChannelListItemPayload extends ConversationActorPayload { listId: string; title: string; status?: ChannelListItemStatus; assigneeId?: string | null; sortOrder?: number }
export interface UpdateChannelListItemPayload extends Omit<CreateChannelListItemPayload, 'title'> { itemId: string; title?: string }
export interface DeleteChannelListItemPayload extends ConversationActorPayload { listId: string; itemId: string }
export interface ChannelClipView { id: string; organizationId: string; conversationId: string; messageId: string | null; createdBy: string; mediaUrl: string; mediaType: 'audio' | 'video'; durationSeconds: number | null; createdAt: string }
export interface CreateChannelClipPayload extends ConversationActorPayload { messageId?: string | null; mediaUrl: string; mediaType: 'audio' | 'video'; durationSeconds?: number | null }
export interface DeleteChannelClipPayload extends ConversationActorPayload { clipId: string }
export interface ChannelHuddleView { id: string; organizationId: string; conversationId: string; status: 'active' | 'ended'; startedBy: string; participantIds: string[]; startedAt: string; endedAt: string | null }
export type WorkflowTriggerType = 'message_contains' | 'channel_created' | 'manual';
export type WorkflowActionType = 'post_message' | 'webhook' | 'set_reminder';
export interface ChannelWorkflowView { id: string; organizationId: string; conversationId: string | null; name: string; enabled: boolean; triggerType: WorkflowTriggerType; triggerConfig: Record<string, unknown>; actionType: WorkflowActionType; actionConfig: Record<string, unknown>; createdBy: string; createdAt: string }
export interface CreateWorkflowPayload { actorId: string; conversationId?: string | null; name: string; enabled?: boolean; triggerType: WorkflowTriggerType; triggerConfig?: Record<string, unknown>; actionType: WorkflowActionType; actionConfig?: Record<string, unknown> }
export interface UpdateWorkflowPayload extends Partial<Omit<CreateWorkflowPayload, 'actorId'>> { actorId: string; workflowId: string; conversationId?: string | null }
export interface DeleteWorkflowPayload { actorId: string; workflowId: string; conversationId?: string | null }
export interface ListWorkflowsPayload { actorId: string; conversationId?: string | null }
export interface RunWorkflowPayload { actorId: string; workflowId: string; conversationId?: string | null }
export interface EvaluateWorkflowsPayload {
  actorId: string;
  conversationId: string;
  triggerType: 'message_contains' | 'channel_created';
  message?: {
    id: string;
    body: string;
    senderId: string;
    botUsername?: string | null;
    conversationId: string;
  } | null;
}
export interface EvaluateWorkflowsResult {
  messages: Array<Record<string, unknown> & { conversationId: string; recipientIds?: string[] }>;
}
export interface SharedChannelInviteView {
  id: string;
  organizationId: string;
  conversationId: string;
  email: string;
  token?: string;
  status: 'pending' | 'accepted' | 'revoked';
  inviteKind?: 'guest_email' | 'workspace_share';
  createdBy: string;
  createdAt: string;
  acceptedAt: string | null;
  inviteUrl?: string | null;
  partnerOrganizationName?: string | null;
}
export interface CreateSharedChannelInvitePayload extends ConversationActorPayload {
  email: string;
  /** guest_email (default) or workspace_share for true multi-org Connect */
  mode?: 'guest' | 'workspace';
}
export interface AcceptSharedChannelInvitePayload { actorId: string; token: string }
export interface AcceptWorkspaceSharePayload {
  actorId: string;
  token: string;
  partnerOrganizationId: string;
  partnerOrganizationName?: string | null;
  hostOrganizationName?: string | null;
}
export interface DisconnectSharedChannelPayload extends ConversationActorPayload {
  linkId: string;
}
export interface SharedChannelLinkView {
  id: string;
  hostOrganizationId: string;
  hostConversationId: string;
  partnerOrganizationId: string;
  partnerConversationId: string;
  partnerOrganizationName: string | null;
  hostOrganizationName: string | null;
  status: 'pending' | 'active' | 'disconnected';
  createdBy: string;
  acceptedBy: string | null;
  createdAt: string;
  disconnectedAt: string | null;
}
export interface SharedChannelInfoView {
  conversationId: string;
  isShared: boolean;
  sharedExternalLabel: string | null;
  conversationName?: string | null;
  organizationName?: string | null;
  invites: SharedChannelInviteView[];
  links?: SharedChannelLinkView[];
  connectRole?: 'host' | 'partner' | null;
  hostConversationId?: string | null;
}
export interface SharedChannelInvitePreviewView {
  valid: boolean;
  message?: string;
  email: string | null;
  conversationId: string | null;
  conversationName: string | null;
  organizationId: string | null;
  organizationName: string | null;
  status?: 'pending' | 'accepted' | 'revoked';
  inviteKind?: 'guest_email' | 'workspace_share';
}
export interface ResolveConnectConversationResult {
  displayConversationId: string;
  effectiveConversationId: string;
  effectiveOrganizationId: string;
  isPartnerStub: boolean;
  linkId?: string | null;
}
export interface RevokeSharedChannelInvitePayload extends ConversationActorPayload { inviteId: string }
export interface MarkSharedInviteAcceptedPayload {
  conversationId: string;
  email: string;
  externalLabel?: string | null;
}
export interface AppCatalogView {
  key: string;
  name: string;
  description: string;
  icon: string;
  installed: boolean;
  configurable?: boolean;
  category?: 'integration' | 'bot';
  oauthRequired?: boolean;
  capabilities?: Array<'unfurl' | 'create_issue' | 'events' | 'meetings'>;
  connected?: boolean;
  connectionStatus?: string | null;
  providerAccountName?: string | null;
}
export interface InstalledAppView {
  id: string;
  organizationId: string;
  appKey: string;
  key: string;
  name?: string;
  description?: string;
  config: Record<string, unknown>;
  installedBy: string;
  createdAt: string;
  connected?: boolean;
  connectionStatus?: string | null;
  providerAccountName?: string | null;
  oauthRequired?: boolean;
  capabilities?: Array<'unfurl' | 'create_issue' | 'events' | 'meetings'>;
}
export interface AppOauthConnectionView {
  appKey: string;
  status: 'connected' | 'needs_reauth' | 'error' | 'disconnected';
  providerAccountId: string | null;
  providerAccountName: string | null;
  scopes: string | null;
  expiresAt: string | null;
  meta: Record<string, unknown>;
  connected: boolean;
}
export interface UpsertAppOauthPayload {
  actorId: string;
  appKey: string;
  accessToken: string;
  refreshToken?: string | null;
  tokenType?: string | null;
  scopes?: string | null;
  expiresAt?: string | null;
  providerAccountId?: string | null;
  providerAccountName?: string | null;
  meta?: Record<string, unknown>;
}
export interface UnfurlAppLinkPayload {
  actorId: string;
  url: string;
}
export interface UnfurlAppLinkResult {
  url: string;
  title: string;
  description: string;
  image: string | null;
  provider?: string | null;
  externalId?: string | null;
}
export interface CreateAppIssuePayload {
  actorId: string;
  conversationId: string;
  messageId: string;
  appKey: 'github' | 'jira';
  title?: string;
  body?: string;
  projectKey?: string;
  repo?: string;
}
export interface CreateAppIssueResult {
  appKey: string;
  externalId: string;
  externalUrl: string;
  title: string;
  message?: Record<string, unknown> & {
    conversationId: string;
    recipientIds?: string[];
  };
}
export interface IngestAppEventPayload {
  appKey: string;
  organizationId: string;
  eventType: string;
  payload: Record<string, unknown>;
  deliveryId?: string | null;
}
export interface ListAppProjectsPayload {
  actorId: string;
  appKey: 'github' | 'jira';
}
export interface AppActorPayload { actorId: string }
export interface InstallAppPayload extends AppActorPayload { appKey: string; config?: Record<string, unknown> }
export interface StandupConfig {
  conversationId: string;
  time: string;
  timezone: string;
  weekdays?: number[];
  questions?: string[];
  summaryOffsetMinutes?: number;
  mode?: 'standup' | 'dsu' | 'daily-meeting';
}
export interface RunStandupNowPayload extends AppActorPayload {
  appKey?: string;
  conversationId?: string;
}
export interface CollectStandupReplyPayload {
  conversationId: string;
  threadRootId: string;
  senderId: string;
  body: string;
  messageId?: string;
  botUsername?: string | null;
}
export interface SummarizeStandupPayload extends AppActorPayload {
  conversationId: string;
  appKey?: string;
}
