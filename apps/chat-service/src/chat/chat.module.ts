import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from '../database/entities/conversation.entity';
import { ConversationMember } from '../database/entities/conversation-member.entity';
import { Message } from '../database/entities/message.entity';
import { MessageHide } from '../database/entities/message-hide.entity';
import { MessageReaction } from '../database/entities/message-reaction.entity';
import { UserBlock } from '../database/entities/user-block.entity';
import { AuditEvent } from '../database/entities/audit-event.entity';
import { WorkspaceSettings } from '../database/entities/workspace-settings.entity';
import { ScheduledMessage } from '../database/entities/scheduled-message.entity';
import { MessageBookmark } from '../database/entities/message-bookmark.entity';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      ConversationMember,
      Message,
      MessageHide,
      MessageReaction,
      UserBlock,
      AuditEvent,
      WorkspaceSettings,
      ScheduledMessage,
      MessageBookmark,
    ]),
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
