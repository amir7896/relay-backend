import { config } from 'dotenv';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { Message } from './entities/message.entity';
import { MessageHide } from './entities/message-hide.entity';
import { MessageReaction } from './entities/message-reaction.entity';
import { UserBlock } from './entities/user-block.entity';
import { AuditEvent } from './entities/audit-event.entity';
import { WorkspaceSettings } from './entities/workspace-settings.entity';
import { CreateChatSchema1730000000000 } from './migrations/1730000000000-CreateChatSchema';
import { AddChatSeenAndMessageType1730000001000 } from './migrations/1730000001000-AddChatSeenAndMessageType';
import { AddChatScaleIndexes1730000002000 } from './migrations/1730000002000-AddChatScaleIndexes';
import { AddChatProductFeatures1730000003000 } from './migrations/1730000003000-AddChatProductFeatures';
import { AddChatEngagementFeatures1730000005000 } from './migrations/1730000005000-AddChatEngagementFeatures';
import { AddSellReadyFeatures1730000006000 } from './migrations/1730000006000-AddSellReadyFeatures';
import { AddCallMessageType1730000007000 } from './migrations/1730000007000-AddCallMessageType';
import { AddMessagePins1730000008000 } from './migrations/1730000008000-AddMessagePins';
import { AddScheduledMessages1730000009000 } from './migrations/1730000009000-AddScheduledMessages';
import { AddDisappearingMessages1730000010000 } from './migrations/1730000010000-AddDisappearingMessages';
import { AddUndeliveredMessages1730000011000 } from './migrations/1730000011000-AddUndeliveredMessages';
import { SharedTenantChatOrganizationId1742000000002 } from './migrations/1742000000002-SharedTenantChatOrganizationId';
import { AddMessagePolls1743000000000 } from './migrations/1743000000000-AddMessagePolls';
import { AddMessageBookmarks1743000001000 } from './migrations/1743000001000-AddMessageBookmarks';
import { AddThreadsChannelsGovernance1743000002000 } from './migrations/1743000002000-AddThreadsChannelsGovernance';
import { AddDraftsAndReminders1743000003000 } from './migrations/1743000003000-AddDraftsAndReminders';
import { AddChannelTopicDescriptionBookmarks1743000004000 } from './migrations/1743000004000-AddChannelTopicDescriptionBookmarks';
import { AddThreadFollows1743000005000 } from './migrations/1743000005000-AddThreadFollows';
import { OpenReactionsAndCustomEmoji1743000006000 } from './migrations/1743000006000-OpenReactionsAndCustomEmoji';
import { AddMessageEdits1743000007000 } from './migrations/1743000007000-AddMessageEdits';
import { AddSidebarSections1743000008000 } from './migrations/1743000008000-AddSidebarSections';
import { AddMessageSearchVector1743000010000 } from './migrations/1743000010000-AddMessageSearchVector';
import { AddMentionsGinIndex1743000011000 } from './migrations/1743000011000-AddMentionsGinIndex';
import { AddIncomingWebhooks1743000012000 } from './migrations/1743000012000-AddIncomingWebhooks';
import { AddSlashCommands1743000013000 } from './migrations/1743000013000-AddSlashCommands';
import { AddUserGroups1743000014000 } from './migrations/1743000014000-AddUserGroups';
import { AddOutgoingWebhooksAndSlashInteractive1743000015000 } from './migrations/1743000015000-AddOutgoingWebhooksAndSlashInteractive';

import { ScheduledMessage } from './entities/scheduled-message.entity';
import { MessageBookmark } from './entities/message-bookmark.entity';
import { ChannelInvite } from './entities/channel-invite.entity';
import { MessageDraft } from './entities/message-draft.entity';
import { SavedReply } from './entities/saved-reply.entity';
import { WikiPage } from './entities/wiki-page.entity';
import { Incident } from './entities/incident.entity';
import { MessageReminder } from './entities/message-reminder.entity';
import { ThreadFollow } from './entities/thread-follow.entity';
import { MessageEdit } from './entities/message-edit.entity';
import { SidebarSection } from './entities/sidebar-section.entity';
import { IncomingWebhook } from './entities/incoming-webhook.entity';
import { OutgoingWebhook } from './entities/outgoing-webhook.entity';
import { SlashCommand } from './entities/slash-command.entity';
import { UserGroup } from './entities/user-group.entity';
import { SLACK_PRODUCT_ENTITIES } from './entities/slack-product.entities';
import { AddSlackProducts1743000016000 } from './migrations/1743000016000-AddSlackProducts';
import { AddStandupRuns1743000017000 } from './migrations/1743000017000-AddStandupRuns';
import { AddReminderCompleted1743000018000 } from './migrations/1743000018000-AddReminderCompleted';
import { AddSharedChannelLinks1743000019000 } from './migrations/1743000019000-AddSharedChannelLinks';
import { AddAppOauthConnections1743000020000 } from './migrations/1743000020000-AddAppOauthConnections';
import { ThreadFollowsIdDefault1743000021000 } from './migrations/1743000021000-ThreadFollowsIdDefault';
import { AddUserNotifications1743000022000 } from './migrations/1743000022000-AddUserNotifications';
import { AddListItemDueAt1743000023000 } from './migrations/1743000023000-AddListItemDueAt';
import { AddListCanvasBookmarkExtras1743000024000 } from './migrations/1743000024000-AddListCanvasBookmarkExtras';
import { AddCanvasYdocState1743000025000 } from './migrations/1743000025000-AddCanvasYdocState';
import { AddListItemJiraFields1743000026000 } from './migrations/1743000026000-AddListItemJiraFields';
import { AddListItemJiraLink1743000027000 } from './migrations/1743000027000-AddListItemJiraLink';
import { AddChannelWhiteboards1743000028000 } from './migrations/1743000028000-AddChannelWhiteboards';
import { AddMessageInteractive1743000029000 } from './migrations/1743000029000-AddMessageInteractive';
import { AddSavedReplies1743000030000 } from './migrations/1743000030000-AddSavedReplies';
import { AddWikiPages1743000031000 } from './migrations/1743000031000-AddWikiPages';
import { AddIncidents1743000032000 } from './migrations/1743000032000-AddIncidents';

config({
  path: [
    resolve(process.cwd(), '.env'),
    resolve(__dirname, '../../../../.env'),
  ],
});

export default new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  username: process.env.POSTGRES_USER ?? 'nest',
  password: process.env.POSTGRES_PASSWORD ?? 'nest',
  database: process.env.CHAT_POSTGRES_DATABASE ?? 'nest_chat',
  entities: [
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
  ],
  migrations: [
    CreateChatSchema1730000000000,
    AddChatSeenAndMessageType1730000001000,
    AddChatScaleIndexes1730000002000,
    AddChatProductFeatures1730000003000,
    AddChatEngagementFeatures1730000005000,
    AddSellReadyFeatures1730000006000,
    AddCallMessageType1730000007000,
    AddMessagePins1730000008000,
    AddScheduledMessages1730000009000,
    AddDisappearingMessages1730000010000,
    AddUndeliveredMessages1730000011000,
    SharedTenantChatOrganizationId1742000000002,
    AddMessagePolls1743000000000,
    AddMessageBookmarks1743000001000,
    AddThreadsChannelsGovernance1743000002000,
    AddDraftsAndReminders1743000003000,
    AddChannelTopicDescriptionBookmarks1743000004000,
    AddThreadFollows1743000005000,
    OpenReactionsAndCustomEmoji1743000006000,
    AddMessageEdits1743000007000,
    AddSidebarSections1743000008000,
    AddMessageSearchVector1743000010000,
    AddMentionsGinIndex1743000011000,
    AddIncomingWebhooks1743000012000,
    AddSlashCommands1743000013000,
    AddUserGroups1743000014000,
    AddOutgoingWebhooksAndSlashInteractive1743000015000,
    AddSlackProducts1743000016000,
    AddStandupRuns1743000017000,
    AddReminderCompleted1743000018000,
    AddSharedChannelLinks1743000019000,
    AddAppOauthConnections1743000020000,
    ThreadFollowsIdDefault1743000021000,
    AddUserNotifications1743000022000,
    AddListItemDueAt1743000023000,
    AddListCanvasBookmarkExtras1743000024000,
    AddCanvasYdocState1743000025000,
    AddListItemJiraFields1743000026000,
    AddListItemJiraLink1743000027000,
    AddChannelWhiteboards1743000028000,
    AddMessageInteractive1743000029000,
    AddSavedReplies1743000030000,
    AddWikiPages1743000031000,
    AddIncidents1743000032000,
  ],
  synchronize: false,
});
