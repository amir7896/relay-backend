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
  ],
  migrations: [
    CreateChatSchema1730000000000,
    AddChatSeenAndMessageType1730000001000,
    AddChatScaleIndexes1730000002000,
    AddChatProductFeatures1730000003000,
    AddChatEngagementFeatures1730000005000,
    AddSellReadyFeatures1730000006000,
  ],
  synchronize: false,
});
