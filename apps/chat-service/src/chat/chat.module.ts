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
import { ChannelInvite } from '../database/entities/channel-invite.entity';
import { MessageDraft } from '../database/entities/message-draft.entity';
import { MessageReminder } from '../database/entities/message-reminder.entity';
import { ThreadFollow } from '../database/entities/thread-follow.entity';
import { MessageEdit } from '../database/entities/message-edit.entity';
import { SidebarSection } from '../database/entities/sidebar-section.entity';
import { IncomingWebhook } from '../database/entities/incoming-webhook.entity';
import { SlashCommand } from '../database/entities/slash-command.entity';
import { UserGroup } from '../database/entities/user-group.entity';
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
      ChannelInvite,
      MessageDraft,
      MessageReminder,
      ThreadFollow,
      MessageEdit,
      SidebarSection,
      IncomingWebhook,
      SlashCommand,
      UserGroup,
    ]),
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
