import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CHAT_PATTERNS } from '@app/contracts';
import type {
  AddMembersPayload,
  BlockUserPayload,
  ConversationActorPayload,
  CreateGroupChatPayload,
  CreatePrivateChatPayload,
  DeleteMessagePayload,
  EditMessagePayload,
  ForwardMessagePayload,
  ListConversationsPayload,
  ListMessagesPayload,
  ListMediaPayload,
  GetMessagePayload,
  MarkSeenPayload,
  MuteConversationPayload,
  PinConversationPayload,
  PinMessagePayload,
  ReactMessagePayload,
  RemoveMemberPayload,
  CancelScheduledMessagePayload,
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
} from '@app/contracts';
import { ChatService } from './chat.service';

@Controller()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @MessagePattern(CHAT_PATTERNS.CREATE_PRIVATE)
  createPrivate(@Payload() payload: CreatePrivateChatPayload) {
    return this.chatService.createPrivate(payload);
  }

  @MessagePattern(CHAT_PATTERNS.CREATE_GROUP)
  createGroup(@Payload() payload: CreateGroupChatPayload) {
    return this.chatService.createGroup(payload);
  }

  @MessagePattern(CHAT_PATTERNS.LIST_CONVERSATIONS)
  listConversations(@Payload() payload: ListConversationsPayload) {
    return this.chatService.listConversations(payload);
  }

  @MessagePattern(CHAT_PATTERNS.GET_CONVERSATION)
  getConversation(@Payload() payload: ConversationActorPayload) {
    return this.chatService.getConversation(payload);
  }

  @MessagePattern(CHAT_PATTERNS.LIST_MESSAGES)
  listMessages(@Payload() payload: ListMessagesPayload) {
    return this.chatService.listMessages(payload);
  }

  @MessagePattern(CHAT_PATTERNS.SEARCH_MESSAGES)
  searchMessages(@Payload() payload: SearchMessagesPayload) {
    return this.chatService.searchMessages(payload);
  }

  @MessagePattern(CHAT_PATTERNS.SEARCH_GLOBAL)
  searchGlobal(@Payload() payload: GlobalSearchMessagesPayload) {
    return this.chatService.searchGlobal(payload);
  }

  @MessagePattern(CHAT_PATTERNS.LIST_MEDIA)
  listMedia(@Payload() payload: ListMediaPayload) {
    return this.chatService.listMedia(payload);
  }

  @MessagePattern(CHAT_PATTERNS.GET_MESSAGE)
  getMessage(@Payload() payload: GetMessagePayload) {
    return this.chatService.getMessage(payload);
  }

  @MessagePattern(CHAT_PATTERNS.SEND_MESSAGE)
  sendMessage(@Payload() payload: SendMessagePayload) {
    return this.chatService.sendMessage(payload);
  }

  @MessagePattern(CHAT_PATTERNS.EDIT_MESSAGE)
  editMessage(@Payload() payload: EditMessagePayload) {
    return this.chatService.editMessage(payload);
  }

  @MessagePattern(CHAT_PATTERNS.REACT_MESSAGE)
  reactMessage(@Payload() payload: ReactMessagePayload) {
    return this.chatService.reactMessage(payload);
  }

  @MessagePattern(CHAT_PATTERNS.PIN_MESSAGE)
  pinMessage(@Payload() payload: PinMessagePayload) {
    return this.chatService.pinMessage(payload);
  }

  @MessagePattern(CHAT_PATTERNS.LIST_PINNED_MESSAGES)
  listPinnedMessages(@Payload() payload: ConversationActorPayload) {
    return this.chatService.listPinnedMessages(payload);
  }

  @MessagePattern(CHAT_PATTERNS.SCHEDULE_MESSAGE)
  scheduleMessage(@Payload() payload: ScheduleMessagePayload) {
    return this.chatService.scheduleMessage(payload);
  }

  @MessagePattern(CHAT_PATTERNS.LIST_SCHEDULED_MESSAGES)
  listScheduledMessages(@Payload() payload: ConversationActorPayload) {
    return this.chatService.listScheduledMessages(payload);
  }

  @MessagePattern(CHAT_PATTERNS.CANCEL_SCHEDULED_MESSAGE)
  cancelScheduledMessage(@Payload() payload: CancelScheduledMessagePayload) {
    return this.chatService.cancelScheduledMessage(payload);
  }

  @MessagePattern(CHAT_PATTERNS.DISPATCH_DUE_SCHEDULED)
  dispatchDueScheduled() {
    return this.chatService.dispatchDueScheduled();
  }

  @MessagePattern(CHAT_PATTERNS.FORWARD_MESSAGE)
  forwardMessage(@Payload() payload: ForwardMessagePayload) {
    return this.chatService.forwardMessage(payload);
  }

  @MessagePattern(CHAT_PATTERNS.MARK_SEEN)
  markSeen(@Payload() payload: MarkSeenPayload) {
    return this.chatService.markSeen(payload);
  }

  @MessagePattern(CHAT_PATTERNS.MUTE_CONVERSATION)
  muteConversation(@Payload() payload: MuteConversationPayload) {
    return this.chatService.muteConversation(payload);
  }

  @MessagePattern(CHAT_PATTERNS.PIN_CONVERSATION)
  pinConversation(@Payload() payload: PinConversationPayload) {
    return this.chatService.pinConversation(payload);
  }

  @MessagePattern(CHAT_PATTERNS.SET_DISAPPEARING)
  setDisappearing(@Payload() payload: SetDisappearingPayload) {
    return this.chatService.setDisappearingMessages(payload);
  }

  @MessagePattern(CHAT_PATTERNS.EXPIRE_DUE_MESSAGES)
  expireDueMessages() {
    return this.chatService.expireDueMessages();
  }

  @MessagePattern(CHAT_PATTERNS.DELETE_MESSAGE)
  deleteMessage(@Payload() payload: DeleteMessagePayload) {
    return this.chatService.deleteMessage(payload);
  }

  @MessagePattern(CHAT_PATTERNS.ADD_MEMBERS)
  addMembers(@Payload() payload: AddMembersPayload) {
    return this.chatService.addMembers(payload);
  }

  @MessagePattern(CHAT_PATTERNS.REMOVE_MEMBER)
  removeMember(@Payload() payload: RemoveMemberPayload) {
    return this.chatService.removeMember(payload);
  }

  @MessagePattern(CHAT_PATTERNS.SET_MEMBER_ROLE)
  setMemberRole(@Payload() payload: SetMemberRolePayload) {
    return this.chatService.setMemberRole(payload);
  }

  @MessagePattern(CHAT_PATTERNS.LEAVE)
  leave(@Payload() payload: ConversationActorPayload) {
    return this.chatService.leave(payload);
  }

  @MessagePattern(CHAT_PATTERNS.UPDATE_GROUP)
  updateGroup(@Payload() payload: UpdateGroupPayload) {
    return this.chatService.updateGroup(payload);
  }

  @MessagePattern(CHAT_PATTERNS.DELETE_GROUP)
  deleteGroup(@Payload() payload: ConversationActorPayload) {
    return this.chatService.deleteGroup(payload);
  }

  @MessagePattern(CHAT_PATTERNS.BLOCK_USER)
  blockUser(@Payload() payload: BlockUserPayload) {
    return this.chatService.blockUser(payload);
  }

  @MessagePattern(CHAT_PATTERNS.UNBLOCK_USER)
  unblockUser(@Payload() payload: BlockUserPayload) {
    return this.chatService.unblockUser(payload);
  }

  @MessagePattern(CHAT_PATTERNS.LIST_BLOCKS)
  listBlocks(@Payload() payload: { actorId: string }) {
    return this.chatService.listBlocks(payload);
  }

  @MessagePattern(CHAT_PATTERNS.PREPARE_VOICE_CALL)
  prepareVoiceCall(@Payload() payload: ConversationActorPayload) {
    return this.chatService.prepareVoiceCall(payload);
  }

  @MessagePattern(CHAT_PATTERNS.GET_ANALYTICS)
  getAnalytics() {
    return this.chatService.getAnalytics();
  }

  @MessagePattern(CHAT_PATTERNS.LIST_AUDIT)
  listAudit(@Payload() payload: ListAuditPayload) {
    return this.chatService.listAuditEvents(payload);
  }

  @MessagePattern(CHAT_PATTERNS.LOG_AUDIT)
  logAudit(@Payload() payload: LogAuditPayload) {
    return this.chatService.logAudit(payload);
  }

  @MessagePattern(CHAT_PATTERNS.GET_WORKSPACE)
  getWorkspace() {
    return this.chatService.getWorkspaceSettings();
  }

  @MessagePattern(CHAT_PATTERNS.UPDATE_WORKSPACE)
  updateWorkspace(@Payload() payload: UpdateWorkspacePayload) {
    return this.chatService.updateWorkspaceSettings(payload);
  }
}
