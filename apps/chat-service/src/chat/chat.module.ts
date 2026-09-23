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
import { SavedReply } from '../database/entities/saved-reply.entity';
import { WikiPage } from '../database/entities/wiki-page.entity';
import { Incident } from '../database/entities/incident.entity';
import { MessageReminder } from '../database/entities/message-reminder.entity';
import { ThreadFollow } from '../database/entities/thread-follow.entity';
import { MessageEdit } from '../database/entities/message-edit.entity';
import { SidebarSection } from '../database/entities/sidebar-section.entity';
import { IncomingWebhook } from '../database/entities/incoming-webhook.entity';
import { OutgoingWebhook } from '../database/entities/outgoing-webhook.entity';
import { SlashCommand } from '../database/entities/slash-command.entity';
import { UserGroup } from '../database/entities/user-group.entity';
import { SLACK_PRODUCT_ENTITIES } from '../database/entities/slack-product.entities';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { SlackProductsService } from './slack-products.service';
import { IntegrationsService } from './integrations.service';

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
      SavedReply,
      WikiPage,
      Incident,
      MessageReminder,
      ThreadFollow,
      MessageEdit,
      SidebarSection,
      IncomingWebhook,
      OutgoingWebhook,
      SlashCommand,
      UserGroup,
      ...SLACK_PRODUCT_ENTITIES,
    ]),
  ],
  controllers: [ChatController],
  providers: [ChatService, SlackProductsService, IntegrationsService],
})
export class ChatModule {}
