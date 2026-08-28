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
  MarkSeenPayload,
  MuteConversationPayload,
  PinConversationPayload,
  ReactMessagePayload,
  RemoveMemberPayload,
  SearchMessagesPayload,
  SendMessagePayload,
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
