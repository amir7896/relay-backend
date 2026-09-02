import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ConversationCacheService } from './conversation-cache.service';
import { PresenceService } from './presence.service';
import { WsAuthService } from './ws-auth.service';
import { AiService } from './ai.service';
import { LinkPreviewService } from './link-preview.service';
import { PushService } from './push.service';

@Module({
  imports: [
    AuthModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      }),
    }),
  ],
  controllers: [ChatController],
  providers: [
    ChatGateway,
    WsAuthService,
    PresenceService,
    ConversationCacheService,
    AiService,
    LinkPreviewService,
    PushService,
  ],
  exports: [PresenceService, AiService, LinkPreviewService, PushService],
})
export class ChatModule {}

