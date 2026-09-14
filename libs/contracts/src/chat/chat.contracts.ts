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
} as const;

export interface CreatePrivateChatPayload {
  actorId: string;
  otherUserId: string;
}

export interface CreateGroupChatPayload {
  actorId: string;
  name: string;
  memberIds: string[];
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
}

export interface SearchMessagesPayload extends ConversationActorPayload {
  query: string;
  page: number;
  limit: number;
}

export interface GlobalSearchMessagesPayload {
  actorId: string;
  query: string;
  page: number;
  limit: number;
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
  attachmentUrl?: string;
  attachmentMime?: string;
  attachmentName?: string;
  attachmentSize?: number;
  mentionUserIds?: string[];
  linkPreview?: LinkPreviewView | null;
  /** Only the call gateway may set this when writing CALL history. */
  systemCall?: boolean;
}

export interface SendMessageResult extends MessageView {
  recipientIds: string[];
  /** Members who muted this conversation (for push filtering). */
  mutedRecipientIds?: string[];
}

export interface EditMessagePayload extends ConversationActorPayload {
  messageId: string;
  body: string;
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
  name: string;
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
  createdAt: string;
}

export interface ConversationView {
  id: string;
  type: ConversationType;
  name: string | null;
  createdBy: string;
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

export interface WorkspaceSettingsView {
  appName: string;
  tagline: string;
  primaryColor: string;
  logoUrl: string | null;
}

export interface UpdateWorkspacePayload {
  actorId: string;
  appName?: string;
  tagline?: string;
  primaryColor?: string;
  logoUrl?: string | null;
}

export interface PurgeOrganizationChatPayload {
  organizationId: string;
  actorId: string;
}
