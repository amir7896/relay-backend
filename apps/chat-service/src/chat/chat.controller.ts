import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { RpcErrors } from '@app/common';
import { CHAT_PATTERNS } from '@app/contracts';
import type {
  AcceptChannelInvitePayload,
  AddChannelBookmarkPayload,
  AddMembersPayload,
  BlockUserPayload,
  ConversationActorPayload,
  CreateChannelInvitePayload,
  PreviewChannelInvitePayload,
  CreateGroupChatPayload,
  CreatePollPayload,
  CreatePrivateChatPayload,
  CreateSidebarSectionPayload,
  DeleteMessagePayload,
  DeleteSidebarSectionPayload,
  EditMessagePayload,
  ForwardMessagePayload,
  JoinChannelPayload,
  ListBookmarksPayload,
  ListConversationMembersPayload,
  ListConversationsPayload,
  ListMessagesPayload,
  ListMediaPayload,
  ListMessageEditsPayload,
  ListMyThreadsPayload,
  ListMyMentionsPayload,
  ListThreadRepliesPayload,
  FollowThreadPayload,
  UnfollowThreadPayload,
  MarkThreadReadPayload,
  GetMessagePayload,
  MarkSeenPayload,
  MarkUnreadPayload,
  MuteConversationPayload,
  PinConversationPayload,
  PinMessagePayload,
  ReactMessagePayload,
  RemoveBookmarkPayload,
  RemoveChannelBookmarkPayload,
  RemoveMemberPayload,
  RevokeChannelInvitePayload,
  CancelScheduledMessagePayload,
  SaveBookmarkPayload,
  ScheduleMessagePayload,
  UpsertDraftPayload,
  ListMyDraftsPayload,
  CreateReminderPayload,
  CancelReminderPayload,
  CompleteReminderPayload,
  ClearCompletedRemindersPayload,
  ListRemindersPayload,
  SearchMessagesPayload,
  GlobalSearchMessagesPayload,
  SendMessagePayload,
  SetDisappearingPayload,
  SetMemberRolePayload,
  ListAuditPayload,
  LogAuditPayload,
  UpdateGroupPayload,
  UpdateSidebarSectionPayload,
  UpdateWorkspacePayload,
  VotePollPayload,
  CreateIncomingWebhookPayload,
  CreateOutgoingWebhookPayload,
  DispatchOutgoingWebhooksPayload,
  ListIncomingWebhooksPayload,
  ListOutgoingWebhooksPayload,
  RevokeIncomingWebhookPayload,
  RevokeOutgoingWebhookPayload,
  PostIncomingWebhookPayload,
  CreateSlashCommandPayload,
  ListSlashCommandsPayload,
  RevokeSlashCommandPayload,
  InvokeSlashCommandPayload,
  CreateUserGroupPayload,
  DeleteUserGroupPayload,
  ListUserGroupsPayload,
  UpdateUserGroupPayload,
} from '@app/contracts';
import { runWithOrganization } from '@app/database';
import { ChatService } from './chat.service';
import { SlackProductsService } from './slack-products.service';
import { IntegrationsService } from './integrations.service';

type TenantChatPayload = {
  organizationId?: string;
};

@Controller()
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly slackProducts: SlackProductsService,
    private readonly integrations: IntegrationsService,
  ) {}

  private withOrg<T>(
    payload: TenantChatPayload,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!payload.organizationId) {
      return RpcErrors.badRequest('organizationId is required') as never;
    }
    return runWithOrganization(payload.organizationId, fn);
  }

  @MessagePattern(CHAT_PATTERNS.CREATE_PRIVATE)
  createPrivate(
    @Payload() payload: CreatePrivateChatPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () => this.chatService.createPrivate(payload));
  }

  @MessagePattern(CHAT_PATTERNS.CREATE_GROUP)
  createGroup(@Payload() payload: CreateGroupChatPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.createGroup(payload));
  }

  @MessagePattern(CHAT_PATTERNS.LIST_CONVERSATIONS)
  listConversations(
    @Payload() payload: ListConversationsPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.listConversations(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.GET_CONVERSATION)
  getConversation(
    @Payload() payload: ConversationActorPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.getConversation(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.LIST_MESSAGES)
  listMessages(@Payload() payload: ListMessagesPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.listMessages(payload));
  }

  @MessagePattern(CHAT_PATTERNS.SEARCH_MESSAGES)
  searchMessages(
    @Payload() payload: SearchMessagesPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.searchMessages(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.SEARCH_GLOBAL)
  searchGlobal(
    @Payload() payload: GlobalSearchMessagesPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () => this.chatService.searchGlobal(payload));
  }

  @MessagePattern(CHAT_PATTERNS.LIST_MEDIA)
  listMedia(@Payload() payload: ListMediaPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.listMedia(payload));
  }

  @MessagePattern(CHAT_PATTERNS.GET_MESSAGE)
  getMessage(@Payload() payload: GetMessagePayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.getMessage(payload));
  }

  @MessagePattern(CHAT_PATTERNS.SEND_MESSAGE)
  sendMessage(@Payload() payload: SendMessagePayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.sendMessage(payload));
  }

  @MessagePattern(CHAT_PATTERNS.EDIT_MESSAGE)
  editMessage(@Payload() payload: EditMessagePayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.editMessage(payload));
  }

  @MessagePattern(CHAT_PATTERNS.LIST_MESSAGE_EDITS)
  listMessageEdits(
    @Payload() payload: ListMessageEditsPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.listMessageEdits(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.REACT_MESSAGE)
  reactMessage(@Payload() payload: ReactMessagePayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.reactMessage(payload));
  }

  @MessagePattern(CHAT_PATTERNS.PIN_MESSAGE)
  pinMessage(@Payload() payload: PinMessagePayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.pinMessage(payload));
  }

  @MessagePattern(CHAT_PATTERNS.CREATE_POLL)
  createPoll(@Payload() payload: CreatePollPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.createPoll(payload));
  }

  @MessagePattern(CHAT_PATTERNS.VOTE_POLL)
  votePoll(@Payload() payload: VotePollPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.votePoll(payload));
  }

  @MessagePattern(CHAT_PATTERNS.SAVE_BOOKMARK)
  saveBookmark(@Payload() payload: SaveBookmarkPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.saveBookmark(payload));
  }

  @MessagePattern(CHAT_PATTERNS.REMOVE_BOOKMARK)
  removeBookmark(@Payload() payload: RemoveBookmarkPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.removeBookmark(payload));
  }

  @MessagePattern(CHAT_PATTERNS.LIST_BOOKMARKS)
  listBookmarks(@Payload() payload: ListBookmarksPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.listBookmarks(payload));
  }

  @MessagePattern(CHAT_PATTERNS.LIST_BOOKMARK_COLLECTIONS)
  listBookmarkCollections(@Payload() payload: { actorId: string } & TenantChatPayload) {
    return this.withOrg(payload, () =>
      this.chatService.listBookmarkCollections(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.CREATE_BOOKMARK_COLLECTION)
  createBookmarkCollection(
    @Payload() payload: { actorId: string; name: string } & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.createBookmarkCollection(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.UPDATE_BOOKMARK_COLLECTION)
  updateBookmarkCollection(
    @Payload()
    payload: {
      actorId: string;
      collectionId: string;
      name: string;
    } & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.updateBookmarkCollection(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.DELETE_BOOKMARK_COLLECTION)
  deleteBookmarkCollection(
    @Payload()
    payload: { actorId: string; collectionId: string } & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.deleteBookmarkCollection(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.MOVE_BOOKMARK)
  moveBookmark(
    @Payload()
    payload: {
      actorId: string;
      messageId: string;
      collectionId?: string | null;
    } & TenantChatPayload,
  ) {
    return this.withOrg(payload, () => this.chatService.moveBookmark(payload));
  }

  @MessagePattern(CHAT_PATTERNS.LIST_PINNED_MESSAGES)
  listPinnedMessages(
    @Payload() payload: ConversationActorPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.listPinnedMessages(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.SCHEDULE_MESSAGE)
  scheduleMessage(
    @Payload() payload: ScheduleMessagePayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.scheduleMessage(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.LIST_SCHEDULED_MESSAGES)
  listScheduledMessages(
    @Payload() payload: ConversationActorPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.listScheduledMessages(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.LIST_MY_SCHEDULED_MESSAGES)
  listMyScheduledMessages(
    @Payload() payload: { actorId: string; page?: number; limit?: number } & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.listMyScheduledMessages(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.CANCEL_SCHEDULED_MESSAGE)
  cancelScheduledMessage(
    @Payload() payload: CancelScheduledMessagePayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.cancelScheduledMessage(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.DISPATCH_DUE_SCHEDULED)
  dispatchDueScheduled() {
    // System job: processes due rows across all organizations.
    return this.chatService.dispatchDueScheduled();
  }

  @MessagePattern(CHAT_PATTERNS.UPSERT_DRAFT)
  upsertDraft(@Payload() payload: UpsertDraftPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.upsertDraft(payload));
  }

  @MessagePattern(CHAT_PATTERNS.GET_DRAFT)
  getDraft(@Payload() payload: ConversationActorPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.getDraft(payload));
  }

  @MessagePattern(CHAT_PATTERNS.CLEAR_DRAFT)
  clearDraft(@Payload() payload: ConversationActorPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.clearDraft(payload));
  }

  @MessagePattern(CHAT_PATTERNS.LIST_MY_DRAFTS)
  listMyDrafts(@Payload() payload: ListMyDraftsPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.listMyDrafts(payload));
  }

  @MessagePattern(CHAT_PATTERNS.CREATE_REMINDER)
  createReminder(
    @Payload() payload: CreateReminderPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.createReminder(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.LIST_REMINDERS)
  listReminders(
    @Payload()
    payload: ListRemindersPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.listReminders(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.CANCEL_REMINDER)
  cancelReminder(
    @Payload() payload: CancelReminderPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.cancelReminder(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.COMPLETE_REMINDER)
  completeReminder(
    @Payload() payload: CompleteReminderPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.completeReminder(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.CLEAR_COMPLETED_REMINDERS)
  clearCompletedReminders(
    @Payload() payload: ClearCompletedRemindersPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.clearCompletedReminders(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.DISPATCH_DUE_REMINDERS)
  dispatchDueReminders() {
    // System job: processes due reminders across all organizations.
    return this.chatService.dispatchDueReminders();
  }

  @MessagePattern(CHAT_PATTERNS.FORWARD_MESSAGE)
  forwardMessage(
    @Payload() payload: ForwardMessagePayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.forwardMessage(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.MARK_SEEN)
  markSeen(@Payload() payload: MarkSeenPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.markSeen(payload));
  }

  @MessagePattern(CHAT_PATTERNS.MARK_UNREAD)
  markUnread(@Payload() payload: MarkUnreadPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.markUnread(payload));
  }

  @MessagePattern(CHAT_PATTERNS.MUTE_CONVERSATION)
  muteConversation(
    @Payload() payload: MuteConversationPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.muteConversation(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.PIN_CONVERSATION)
  pinConversation(
    @Payload() payload: PinConversationPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.pinConversation(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.REORDER_PINNED_CONVERSATIONS)
  reorderPinnedConversations(
    @Payload()
    payload: {
      actorId: string;
      conversationIds: string[];
    } & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.reorderPinnedConversations(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.SET_DISAPPEARING)
  setDisappearing(
    @Payload() payload: SetDisappearingPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.setDisappearingMessages(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.EXPIRE_DUE_MESSAGES)
  expireDueMessages() {
    // System job: expires due messages across all organizations.
    return this.chatService.expireDueMessages();
  }

  @MessagePattern(CHAT_PATTERNS.DELETE_MESSAGE)
  deleteMessage(@Payload() payload: DeleteMessagePayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.deleteMessage(payload));
  }

  @MessagePattern(CHAT_PATTERNS.ENSURE_GENERAL_MEMBER)
  ensureGeneralMember(
    @Payload()
    payload: { userId: string } & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.ensureGeneralMembership({ userId: payload.userId }),
    );
  }

  @MessagePattern(CHAT_PATTERNS.ENSURE_CHANNEL_MEMBER)
  ensureChannelMember(
    @Payload()
    payload: {
      userId: string;
      conversationId: string;
    } & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.ensureChannelMembership({
        userId: payload.userId,
        conversationId: payload.conversationId,
      }),
    );
  }

  @MessagePattern(CHAT_PATTERNS.ADD_MEMBERS)
  addMembers(@Payload() payload: AddMembersPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.addMembers(payload));
  }

  @MessagePattern(CHAT_PATTERNS.REMOVE_MEMBER)
  removeMember(@Payload() payload: RemoveMemberPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.removeMember(payload));
  }

  @MessagePattern(CHAT_PATTERNS.SET_MEMBER_ROLE)
  setMemberRole(@Payload() payload: SetMemberRolePayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.setMemberRole(payload));
  }

  @MessagePattern(CHAT_PATTERNS.LEAVE)
  leave(@Payload() payload: ConversationActorPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.leave(payload));
  }

  @MessagePattern(CHAT_PATTERNS.UPDATE_GROUP)
  updateGroup(@Payload() payload: UpdateGroupPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.updateGroup(payload));
  }

  @MessagePattern(CHAT_PATTERNS.ADD_CHANNEL_BOOKMARK)
  addChannelBookmark(
    @Payload() payload: AddChannelBookmarkPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.addChannelBookmark(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.REMOVE_CHANNEL_BOOKMARK)
  removeChannelBookmark(
    @Payload() payload: RemoveChannelBookmarkPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.removeChannelBookmark(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.LIST_SIDEBAR_SECTIONS)
  listSidebarSections(
    @Payload() payload: { actorId: string } & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.listSidebarSections(payload.actorId),
    );
  }

  @MessagePattern(CHAT_PATTERNS.CREATE_SIDEBAR_SECTION)
  createSidebarSection(
    @Payload() payload: CreateSidebarSectionPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.createSidebarSection(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.UPDATE_SIDEBAR_SECTION)
  updateSidebarSection(
    @Payload() payload: UpdateSidebarSectionPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.updateSidebarSection(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.DELETE_SIDEBAR_SECTION)
  deleteSidebarSection(
    @Payload() payload: DeleteSidebarSectionPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.deleteSidebarSection(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.LIST_THREAD_REPLIES)
  listThreadReplies(
    @Payload() payload: ListThreadRepliesPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.listThreadReplies(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.LIST_MY_THREADS)
  listMyThreads(
    @Payload() payload: ListMyThreadsPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () => this.chatService.listMyThreads(payload));
  }

  @MessagePattern(CHAT_PATTERNS.LIST_MY_MENTIONS)
  listMyMentions(
    @Payload() payload: ListMyMentionsPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () => this.chatService.listMyMentions(payload));
  }

  @MessagePattern(CHAT_PATTERNS.FOLLOW_THREAD)
  followThread(
    @Payload() payload: FollowThreadPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () => this.chatService.followThread(payload));
  }

  @MessagePattern(CHAT_PATTERNS.UNFOLLOW_THREAD)
  unfollowThread(
    @Payload() payload: UnfollowThreadPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.unfollowThread(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.MARK_THREAD_READ)
  markThreadRead(
    @Payload() payload: MarkThreadReadPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.markThreadRead(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.LIST_PUBLIC_CHANNELS)
  listPublicChannels(
    @Payload()
    payload: {
      actorId: string;
      page?: number;
      limit?: number;
    } & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.listPublicChannels(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.JOIN_CHANNEL)
  joinChannel(@Payload() payload: JoinChannelPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.joinChannel(payload));
  }

  @MessagePattern(CHAT_PATTERNS.LIST_CONVERSATION_MEMBERS)
  listConversationMembers(
    @Payload() payload: ListConversationMembersPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.listConversationMembers(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.CREATE_CHANNEL_INVITE)
  createChannelInvite(
    @Payload() payload: CreateChannelInvitePayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.createChannelInvite(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.PREVIEW_CHANNEL_INVITE)
  previewChannelInvite(@Payload() payload: PreviewChannelInvitePayload) {
    // Token is globally unique — no tenant context required.
    return this.chatService.previewChannelInvite(payload);
  }

  @MessagePattern(CHAT_PATTERNS.ACCEPT_CHANNEL_INVITE)
  acceptChannelInvite(@Payload() payload: AcceptChannelInvitePayload) {
    // Resolves invite org internally; do not bind to caller's active org first.
    return this.chatService.acceptChannelInvite(payload);
  }

  @MessagePattern(CHAT_PATTERNS.REVOKE_CHANNEL_INVITE)
  revokeChannelInvite(
    @Payload() payload: RevokeChannelInvitePayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.revokeChannelInvite(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.LIST_CHANNEL_INVITES)
  listChannelInvites(
    @Payload()
    payload: ConversationActorPayload & {
      page?: number;
      limit?: number;
    } & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.listChannelInvites(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.CREATE_INCOMING_WEBHOOK)
  createIncomingWebhook(
    @Payload() payload: CreateIncomingWebhookPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.createIncomingWebhook(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.LIST_INCOMING_WEBHOOKS)
  listIncomingWebhooks(
    @Payload() payload: ListIncomingWebhooksPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.listIncomingWebhooks(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.REVOKE_INCOMING_WEBHOOK)
  revokeIncomingWebhook(
    @Payload() payload: RevokeIncomingWebhookPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.revokeIncomingWebhook(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.POST_INCOMING_WEBHOOK)
  postIncomingWebhook(@Payload() payload: PostIncomingWebhookPayload) {
    return this.chatService.postIncomingWebhook(payload);
  }

  @MessagePattern(CHAT_PATTERNS.CREATE_OUTGOING_WEBHOOK)
  createOutgoingWebhook(
    @Payload() payload: CreateOutgoingWebhookPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.createOutgoingWebhook(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.LIST_OUTGOING_WEBHOOKS)
  listOutgoingWebhooks(
    @Payload() payload: ListOutgoingWebhooksPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.listOutgoingWebhooks(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.REVOKE_OUTGOING_WEBHOOK)
  revokeOutgoingWebhook(
    @Payload() payload: RevokeOutgoingWebhookPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.revokeOutgoingWebhook(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.DISPATCH_OUTGOING_WEBHOOKS)
  dispatchOutgoingWebhooks(
    @Payload() payload: DispatchOutgoingWebhooksPayload,
  ) {
    return this.chatService.dispatchOutgoingWebhooks(payload);
  }

  @MessagePattern(CHAT_PATTERNS.LIST_SLASH_COMMANDS)
  listSlashCommands(
    @Payload() payload: ListSlashCommandsPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.listSlashCommands(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.CREATE_SLASH_COMMAND)
  createSlashCommand(
    @Payload() payload: CreateSlashCommandPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.createSlashCommand(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.REVOKE_SLASH_COMMAND)
  revokeSlashCommand(
    @Payload() payload: RevokeSlashCommandPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.revokeSlashCommand(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.INVOKE_SLASH_COMMAND)
  invokeSlashCommand(
    @Payload() payload: InvokeSlashCommandPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.invokeSlashCommand(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.LIST_USER_GROUPS)
  listUserGroups(
    @Payload() payload: ListUserGroupsPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.listUserGroups(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.CREATE_USER_GROUP)
  createUserGroup(
    @Payload() payload: CreateUserGroupPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.createUserGroup(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.UPDATE_USER_GROUP)
  updateUserGroup(
    @Payload() payload: UpdateUserGroupPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.updateUserGroup(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.DELETE_USER_GROUP)
  deleteUserGroup(
    @Payload() payload: DeleteUserGroupPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.deleteUserGroup(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.GET_CANVAS) getCanvas(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.getCanvas(p)); }
  @MessagePattern(CHAT_PATTERNS.PUT_CANVAS) putCanvas(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.putCanvas(p)); }
  @MessagePattern(CHAT_PATTERNS.SAVE_CANVAS_YDOC) saveCanvasYdoc(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.saveCanvasYdoc(p)); }
  @MessagePattern(CHAT_PATTERNS.LIST_CANVAS_COMMENTS) listCanvasComments(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.listCanvasComments(p)); }
  @MessagePattern(CHAT_PATTERNS.CREATE_CANVAS_COMMENT) createCanvasComment(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.createCanvasComment(p)); }
  @MessagePattern(CHAT_PATTERNS.RESOLVE_CANVAS_COMMENT) resolveCanvasComment(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.resolveCanvasComment(p)); }
  @MessagePattern(CHAT_PATTERNS.DELETE_CANVAS_COMMENT) deleteCanvasComment(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.deleteCanvasComment(p)); }
  @MessagePattern(CHAT_PATTERNS.LIST_CHANNEL_LISTS) listChannelLists(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.listLists(p)); }
  @MessagePattern(CHAT_PATTERNS.GET_CHANNEL_LIST) getChannelList(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.getList(p)); }
  @MessagePattern(CHAT_PATTERNS.CREATE_CHANNEL_LIST) createChannelList(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.createList(p)); }
  @MessagePattern(CHAT_PATTERNS.UPDATE_CHANNEL_LIST) updateChannelList(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.updateList(p)); }
  @MessagePattern(CHAT_PATTERNS.DELETE_CHANNEL_LIST) deleteChannelList(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.deleteList(p)); }
  @MessagePattern(CHAT_PATTERNS.CREATE_CHANNEL_LIST_ITEM) createChannelListItem(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.createListItem(p)); }
  @MessagePattern(CHAT_PATTERNS.UPDATE_CHANNEL_LIST_ITEM) updateChannelListItem(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.updateListItem(p)); }
  @MessagePattern(CHAT_PATTERNS.DELETE_CHANNEL_LIST_ITEM) deleteChannelListItem(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.deleteListItem(p)); }
  @MessagePattern(CHAT_PATTERNS.LIST_CHANNEL_LIST_ITEM_COMMENTS) listChannelListItemComments(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.listListItemComments(p)); }
  @MessagePattern(CHAT_PATTERNS.CREATE_CHANNEL_LIST_ITEM_COMMENT) createChannelListItemComment(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.createListItemComment(p)); }
  @MessagePattern(CHAT_PATTERNS.DELETE_CHANNEL_LIST_ITEM_COMMENT) deleteChannelListItemComment(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.deleteListItemComment(p)); }
  @MessagePattern(CHAT_PATTERNS.LIST_USER_NOTIFICATIONS) listUserNotifications(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.listUserNotifications(p)); }
  @MessagePattern(CHAT_PATTERNS.MARK_USER_NOTIFICATION_READ) markUserNotificationRead(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.markUserNotificationRead(p)); }
  @MessagePattern(CHAT_PATTERNS.MARK_ALL_USER_NOTIFICATIONS_READ) markAllUserNotificationsRead(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.markAllUserNotificationsRead(p)); }
  @MessagePattern(CHAT_PATTERNS.COUNT_UNREAD_USER_NOTIFICATIONS) countUnreadUserNotifications(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.countUnreadUserNotifications(p)); }
  @MessagePattern(CHAT_PATTERNS.LIST_CLIPS) listClips(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.listClips(p)); }
  @MessagePattern(CHAT_PATTERNS.CREATE_CLIP) createClip(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.createClip(p)); }
  @MessagePattern(CHAT_PATTERNS.DELETE_CLIP) deleteClip(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.deleteClip(p)); }
  @MessagePattern(CHAT_PATTERNS.GET_HUDDLE) getHuddle(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.getHuddle(p)); }
  @MessagePattern(CHAT_PATTERNS.START_HUDDLE) startHuddle(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.startHuddle(p)); }
  @MessagePattern(CHAT_PATTERNS.JOIN_HUDDLE) joinHuddle(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.joinHuddle(p)); }
  @MessagePattern(CHAT_PATTERNS.LEAVE_HUDDLE) leaveHuddle(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.leaveHuddle(p)); }
  @MessagePattern(CHAT_PATTERNS.END_HUDDLE) endHuddle(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.endHuddle(p)); }
  @MessagePattern(CHAT_PATTERNS.LIST_WORKFLOWS) listWorkflows(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.listWorkflows(p)); }
  @MessagePattern(CHAT_PATTERNS.CREATE_WORKFLOW) createWorkflow(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.createWorkflow(p)); }
  @MessagePattern(CHAT_PATTERNS.UPDATE_WORKFLOW) updateWorkflow(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.updateWorkflow(p)); }
  @MessagePattern(CHAT_PATTERNS.DELETE_WORKFLOW) deleteWorkflow(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.deleteWorkflow(p)); }
  @MessagePattern(CHAT_PATTERNS.RUN_WORKFLOW) runWorkflow(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.runWorkflow(p)); }
  @MessagePattern(CHAT_PATTERNS.EVALUATE_WORKFLOWS) evaluateWorkflows(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.evaluateWorkflows(p)); }
  @MessagePattern(CHAT_PATTERNS.CREATE_SHARED_INVITE) createSharedInvite(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.createSharedInvite(p)); }
  @MessagePattern(CHAT_PATTERNS.GET_SHARED_INFO) getSharedInfo(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.getSharedInfo(p)); }
  @MessagePattern(CHAT_PATTERNS.ACCEPT_SHARED_INVITE) acceptSharedInvite(@Payload() p: any) { return this.slackProducts.acceptSharedInvite(p); }
  @MessagePattern(CHAT_PATTERNS.ACCEPT_WORKSPACE_SHARE) acceptWorkspaceShare(@Payload() p: any) { return this.slackProducts.acceptWorkspaceShare(p); }
  @MessagePattern(CHAT_PATTERNS.DISCONNECT_SHARED_CHANNEL) disconnectSharedChannel(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.disconnectSharedChannel(p)); }
  @MessagePattern(CHAT_PATTERNS.RESOLVE_CONNECT_CONVERSATION) resolveConnectConversation(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.resolveConnectConversation(p)); }
  @MessagePattern(CHAT_PATTERNS.PREVIEW_SHARED_INVITE) previewSharedInvite(@Payload() p: any) { return this.slackProducts.previewSharedInvite(p); }
  @MessagePattern(CHAT_PATTERNS.REVOKE_SHARED_INVITE) revokeSharedInvite(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.revokeSharedInvite(p)); }
  @MessagePattern(CHAT_PATTERNS.MARK_SHARED_INVITE_ACCEPTED) markSharedInviteAccepted(@Payload() p: any) { return this.slackProducts.markSharedInviteAccepted(p); }
  @MessagePattern(CHAT_PATTERNS.BIND_SHARED_INVITE_TOKEN) bindSharedInviteToken(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.bindSharedInviteToken(p)); }
  @MessagePattern(CHAT_PATTERNS.LIST_APP_CATALOG) listAppCatalog(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.listAppCatalog()); }
  @MessagePattern(CHAT_PATTERNS.INSTALL_APP) installApp(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.installApp(p)); }
  @MessagePattern(CHAT_PATTERNS.UNINSTALL_APP) uninstallApp(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.uninstallApp(p)); }
  @MessagePattern(CHAT_PATTERNS.LIST_INSTALLED_APPS) listInstalledApps(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.listInstalledApps()); }
  @MessagePattern(CHAT_PATTERNS.UPSERT_APP_OAUTH) upsertAppOauth(@Payload() p: any) { return this.withOrg(p, () => this.integrations.upsertOauth(p)); }
  @MessagePattern(CHAT_PATTERNS.GET_APP_OAUTH_STATUS) getAppOauthStatus(@Payload() p: any) { return this.withOrg(p, () => this.integrations.getOauthStatus(p)); }
  @MessagePattern(CHAT_PATTERNS.DISCONNECT_APP_OAUTH) disconnectAppOauth(@Payload() p: any) { return this.withOrg(p, () => this.integrations.disconnectOauth(p)); }
  @MessagePattern(CHAT_PATTERNS.UNFURL_APP_LINK) unfurlAppLink(@Payload() p: any) { return this.withOrg(p, () => this.integrations.unfurlLink(p)); }
  @MessagePattern(CHAT_PATTERNS.CREATE_APP_ISSUE_FROM_MESSAGE) createAppIssueFromMessage(@Payload() p: any) { return this.withOrg(p, () => this.integrations.createIssueFromMessage(p)); }
  @MessagePattern(CHAT_PATTERNS.CREATE_APP_ISSUE_FROM_LIST_ITEM) createAppIssueFromListItem(@Payload() p: any) { return this.withOrg(p, () => this.integrations.createIssueFromListItem(p)); }
  @MessagePattern(CHAT_PATTERNS.CREATE_ZOOM_MEETING) createZoomMeeting(@Payload() p: any) { return this.withOrg(p, () => this.integrations.createZoomMeeting(p)); }
  @MessagePattern(CHAT_PATTERNS.INGEST_APP_EVENT) ingestAppEvent(@Payload() p: any) { return this.integrations.ingestEvent(p); }
  @MessagePattern(CHAT_PATTERNS.LIST_APP_PROJECTS) listAppProjects(@Payload() p: any) { return this.withOrg(p, () => this.integrations.listProjects(p)); }
  @MessagePattern(CHAT_PATTERNS.DISPATCH_DUE_STANDUPS) dispatchDueStandups() { return this.slackProducts.dispatchDueStandups(); }
  @MessagePattern(CHAT_PATTERNS.DISPATCH_DUE_LIST_ITEMS) dispatchDueListItems() { return this.slackProducts.dispatchDueListItems(); }
  @MessagePattern(CHAT_PATTERNS.RUN_STANDUP_NOW) runStandupNow(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.runStandupNow(p)); }
  @MessagePattern(CHAT_PATTERNS.COLLECT_STANDUP_REPLY) collectStandupReply(@Payload() p: any) { return this.slackProducts.collectStandupReply(p); }
  @MessagePattern(CHAT_PATTERNS.SUMMARIZE_STANDUP) summarizeStandup(@Payload() p: any) { return this.withOrg(p, () => this.slackProducts.summarizeStandup(p)); }

  @MessagePattern(CHAT_PATTERNS.DELETE_GROUP)
  deleteGroup(
    @Payload() payload: ConversationActorPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () => this.chatService.deleteGroup(payload));
  }

  @MessagePattern(CHAT_PATTERNS.BLOCK_USER)
  blockUser(@Payload() payload: BlockUserPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.blockUser(payload));
  }

  @MessagePattern(CHAT_PATTERNS.UNBLOCK_USER)
  unblockUser(@Payload() payload: BlockUserPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.unblockUser(payload));
  }

  @MessagePattern(CHAT_PATTERNS.LIST_BLOCKS)
  listBlocks(
    @Payload()
    payload: {
      actorId: string;
      page?: number;
      limit?: number;
    } & TenantChatPayload,
  ) {
    return this.withOrg(payload, () => this.chatService.listBlocks(payload));
  }

  @MessagePattern(CHAT_PATTERNS.PREPARE_VOICE_CALL)
  prepareVoiceCall(
    @Payload() payload: ConversationActorPayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.prepareVoiceCall(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.GET_ANALYTICS)
  getAnalytics(@Payload() payload: TenantChatPayload = {}) {
    return this.withOrg(payload, () => this.chatService.getAnalytics());
  }

  @MessagePattern(CHAT_PATTERNS.LIST_AUDIT)
  listAudit(@Payload() payload: ListAuditPayload & TenantChatPayload) {
    return this.withOrg(payload, () =>
      this.chatService.listAuditEvents(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.LOG_AUDIT)
  logAudit(@Payload() payload: LogAuditPayload & TenantChatPayload) {
    return this.withOrg(payload, () => this.chatService.logAudit(payload));
  }

  @MessagePattern(CHAT_PATTERNS.GET_WORKSPACE)
  getWorkspace(@Payload() payload: TenantChatPayload = {}) {
    return this.withOrg(payload, () => this.chatService.getWorkspaceSettings());
  }

  @MessagePattern(CHAT_PATTERNS.UPDATE_WORKSPACE)
  updateWorkspace(
    @Payload() payload: UpdateWorkspacePayload & TenantChatPayload,
  ) {
    return this.withOrg(payload, () =>
      this.chatService.updateWorkspaceSettings(payload),
    );
  }

  @MessagePattern(CHAT_PATTERNS.PURGE_ORGANIZATION)
  purgeOrganization(
    @Payload() payload: { organizationId?: string; actorId?: string },
  ) {
    if (!payload.organizationId?.trim()) {
      return RpcErrors.badRequest('organizationId is required');
    }
    return this.chatService.purgeOrganization(payload.organizationId.trim());
  }
}
