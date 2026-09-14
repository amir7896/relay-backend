import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { RpcErrors } from '@app/common';
import { CHAT_PATTERNS } from '@app/contracts';
import type {
  AddMembersPayload,
  BlockUserPayload,
  ConversationActorPayload,
  CreateGroupChatPayload,
  CreatePollPayload,
  CreatePrivateChatPayload,
  DeleteMessagePayload,
  EditMessagePayload,
  ForwardMessagePayload,
  ListBookmarksPayload,
  ListConversationsPayload,
  ListMessagesPayload,
  ListMediaPayload,
  GetMessagePayload,
  MarkSeenPayload,
  MuteConversationPayload,
  PinConversationPayload,
  PinMessagePayload,
  ReactMessagePayload,
  RemoveBookmarkPayload,
  RemoveMemberPayload,
  CancelScheduledMessagePayload,
  SaveBookmarkPayload,
  ScheduleMessagePayload,
  SearchMessagesPayload,
  GlobalSearchMessagesPayload,
  SendMessagePayload,
  SetDisappearingPayload,
  SetMemberRolePayload,
  ListAuditPayload,
  LogAuditPayload,
  UpdateGroupPayload,
  UpdateWorkspacePayload,
  VotePollPayload,
} from '@app/contracts';
import { runWithOrganization } from '@app/database';
import { ChatService } from './chat.service';

type TenantChatPayload = {
  organizationId?: string;
};

@Controller()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

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
  listBlocks(@Payload() payload: { actorId: string } & TenantChatPayload) {
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
