import { applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
  ApiWrappedResponse,
} from '@app/common';
import {
  AddMembersDto,
  CreateGroupChatDto,
  CreatePrivateChatDto,
  MarkSeenDto,
  MarkUnreadDto,
  SendMessageDto,
  TypingDto,
  UpdateGroupDto,
} from '../dto/chat.dto';
import {
  ConversationSchema,
  DeletedGroupResultSchema,
  LeftResultSchema,
  MessageSchema,
  PresenceSchema,
  SeenResultSchema,
  TypingResultSchema,
} from './chat.schema';

export const ChatDocs = () =>
  applyDecorators(ApiTags('Chat'), ApiBearerAuth(), ApiErrorResponses());

export const CreatePrivateChatDocs = () =>
  applyDecorators(
    ApiOperation({
      summary: 'Start or reuse a private chat',
      description:
        'Creates a 1:1 conversation with another user, or returns the existing one.',
    }),
    ApiBody({ type: CreatePrivateChatDto }),
    ApiWrappedResponse(ConversationSchema, {
      status: 201,
      description: 'Private conversation ready',
    }),
  );

export const CreateGroupChatDocs = () =>
  applyDecorators(
    ApiOperation({ summary: 'Create a group chat' }),
    ApiBody({ type: CreateGroupChatDto }),
    ApiWrappedResponse(ConversationSchema, {
      status: 201,
      description: 'Group created successfully',
    }),
  );

export const ListConversationsDocs = () =>
  applyDecorators(
    ApiOperation({ summary: 'List my conversations' }),
    ApiPaginatedResponse(ConversationSchema),
  );

export const GetConversationDocs = () =>
  applyDecorators(
    ApiOperation({ summary: 'Get a conversation I belong to' }),
    ApiParam({ name: 'id', type: String, format: 'uuid' }),
    ApiWrappedResponse(ConversationSchema, {
      description: 'Conversation retrieved successfully',
    }),
  );

export const ListMessagesDocs = () =>
  applyDecorators(
    ApiOperation({ summary: 'List messages in a conversation (newest first)' }),
    ApiParam({ name: 'id', type: String, format: 'uuid' }),
    ApiPaginatedResponse(MessageSchema),
  );

export const SendMessageDocs = () =>
  applyDecorators(
    ApiOperation({ summary: 'Send a message in a conversation' }),
    ApiParam({ name: 'id', type: String, format: 'uuid' }),
    ApiBody({ type: SendMessageDto }),
    ApiWrappedResponse(MessageSchema, {
      status: 201,
      description: 'Message sent successfully',
    }),
  );

export const AddMembersDocs = () =>
  applyDecorators(
    ApiOperation({ summary: 'Add members to a group (owner or admin)' }),
    ApiParam({ name: 'id', type: String, format: 'uuid' }),
    ApiBody({ type: AddMembersDto }),
    ApiWrappedResponse(ConversationSchema, {
      description: 'Members added successfully',
    }),
  );

export const RemoveMemberDocs = () =>
  applyDecorators(
    ApiOperation({ summary: 'Remove a member from a group (owner or admin)' }),
    ApiParam({ name: 'id', type: String, format: 'uuid' }),
    ApiParam({ name: 'userId', type: String, format: 'uuid' }),
    ApiWrappedResponse(ConversationSchema, {
      description: 'Member removed successfully',
    }),
  );

export const LeaveConversationDocs = () =>
  applyDecorators(
    ApiOperation({ summary: 'Leave a group chat' }),
    ApiParam({ name: 'id', type: String, format: 'uuid' }),
    ApiWrappedResponse(LeftResultSchema, {
      description: 'You left the conversation',
    }),
  );

export const UpdateGroupDocs = () =>
  applyDecorators(
    ApiOperation({ summary: 'Rename a group (owner or admin)' }),
    ApiParam({ name: 'id', type: String, format: 'uuid' }),
    ApiBody({ type: UpdateGroupDto }),
    ApiWrappedResponse(ConversationSchema, {
      description: 'Group updated successfully',
    }),
  );

export const DeleteGroupDocs = () =>
  applyDecorators(
    ApiOperation({
      summary: 'Delete a group',
      description: 'Only the member who created the group can delete it.',
    }),
    ApiParam({ name: 'id', type: String, format: 'uuid' }),
    ApiWrappedResponse(DeletedGroupResultSchema, {
      description: 'Group deleted successfully',
    }),
  );

export const TypingDocs = () =>
  applyDecorators(
    ApiOperation({
      summary: 'Broadcast typing status to the conversation',
      description:
        'Useful from Postman. Connected Socket.IO clients in the room receive `chat:typing`.',
    }),
    ApiParam({ name: 'id', type: String, format: 'uuid' }),
    ApiBody({ type: TypingDto }),
    ApiWrappedResponse(TypingResultSchema, {
      description: 'Typing status updated',
    }),
  );

export const MarkSeenDocs = () =>
  applyDecorators(
    ApiOperation({
      summary: 'Mark messages as seen',
      description:
        'Updates your last-read cursor. Other members see your id in `seenBy` and receive `chat:seen`.',
    }),
    ApiParam({ name: 'id', type: String, format: 'uuid' }),
    ApiBody({ type: MarkSeenDto, required: false }),
    ApiWrappedResponse(SeenResultSchema, {
      description: 'Messages marked as seen',
    }),
  );

export const MarkUnreadDocs = () =>
  applyDecorators(
    ApiOperation({
      summary: 'Mark conversation unread from a message',
      description:
        'Rewinds your last-read cursor so the chosen message (and later messages) count as unread. Peers receive `chat:unseen` so read receipts (ticks) drop back to delivered for those messages.',
    }),
    ApiParam({ name: 'id', type: String, format: 'uuid' }),
    ApiBody({ type: MarkUnreadDto }),
    ApiWrappedResponse(SeenResultSchema, {
      description: 'Conversation marked as unread',
    }),
  );

export const GetPresenceDocs = () =>
  applyDecorators(
    ApiOperation({
      summary: 'Get online or offline status for a user',
      description:
        'Online while that user has an active Socket.IO connection to `/chat`.',
    }),
    ApiParam({ name: 'userId', type: String, format: 'uuid' }),
    ApiWrappedResponse(PresenceSchema, {
      description: 'Presence retrieved successfully',
    }),
  );
