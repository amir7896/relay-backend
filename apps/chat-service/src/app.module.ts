import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { chatEnvSchema } from '@app/common';
import { createTypeOrmOptions } from '@app/database';
import { ChatModule } from './chat/chat.module';
import { Conversation } from './database/entities/conversation.entity';
import { ConversationMember } from './database/entities/conversation-member.entity';
import { Message } from './database/entities/message.entity';
import { MessageHide } from './database/entities/message-hide.entity';
import { MessageReaction } from './database/entities/message-reaction.entity';
import { UserBlock } from './database/entities/user-block.entity';
import { AuditEvent } from './database/entities/audit-event.entity';
import { WorkspaceSettings } from './database/entities/workspace-settings.entity';
import { ScheduledMessage } from './database/entities/scheduled-message.entity';
import { MessageBookmark } from './database/entities/message-bookmark.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validationSchema: chatEnvSchema,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createTypeOrmOptions({
          host: config.getOrThrow<string>('POSTGRES_HOST'),
          port: config.get<number>('POSTGRES_PORT', 5432),
          username: config.getOrThrow<string>('POSTGRES_USER'),
          password: config.getOrThrow<string>('POSTGRES_PASSWORD'),
          database: config.getOrThrow<string>('CHAT_POSTGRES_DATABASE'),
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
          ],
          poolMax: config.get<number>('POSTGRES_POOL_MAX', 20),
          poolMin: config.get<number>('POSTGRES_POOL_MIN', 2),
        }),
    }),
    ChatModule,
  ],
})
export class AppModule {}
