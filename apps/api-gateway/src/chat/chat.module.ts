import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MailModule } from '@app/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { ChatController } from './chat.controller';
import { SlackProductsController } from './slack-products.controller';
import { IncomingWebhooksController } from './incoming-webhooks.controller';
import { ChatGateway } from './chat.gateway';
import { ConversationCacheService } from './conversation-cache.service';
import { PresenceService } from './presence.service';
import { WsAuthService } from './ws-auth.service';
import { AiService } from './ai.service';
import { CallSessionService } from './call-session.service';
import { LinkPreviewService } from './link-preview.service';
import { PushService } from './push.service';
import { NotificationPrefsService } from './notification-prefs.service';
import { ScheduledMessageDispatcher } from './scheduled-message.dispatcher';
import { ReminderDispatcher } from './reminder.dispatcher';
import { DisappearingMessageDispatcher } from './disappearing-message.dispatcher';

@Module({
  imports: [
    AuthModule,
    StorageModule,
    MailModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      }),
    }),
  ],
  controllers: [ChatController, SlackProductsController, IncomingWebhooksController],
  providers: [
    ChatGateway,
    WsAuthService,
    PresenceService,
    ConversationCacheService,
    CallSessionService,
    AiService,
    LinkPreviewService,
    NotificationPrefsService,
    PushService,
    ScheduledMessageDispatcher,
    ReminderDispatcher,
    DisappearingMessageDispatcher,
  ],
  exports: [PresenceService, AiService, LinkPreviewService, PushService],
})
export class ChatModule {}

