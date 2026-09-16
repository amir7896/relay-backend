import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '@app/common';
import { CHAT_PATTERNS } from '@app/contracts';
import type { SendMessageResult } from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { SkipOrg } from '../organizations/skip-org.decorator';
import { ChatGateway } from './chat.gateway';
import { PostIncomingWebhookDto } from './dto/chat.dto';

@ApiTags('Incoming Webhooks')
@Controller('hooks')
@SkipOrg()
export class IncomingWebhooksController {
  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly chatGateway: ChatGateway,
  ) {}

  /** Slack-style public incoming webhook — no auth; token is the secret. */
  @Public()
  @Post('incoming/:token')
  @HttpCode(HttpStatus.OK)
  async postIncoming(
    @Param('token') token: string,
    @Body() dto: PostIncomingWebhookDto,
  ) {
    const result = await this.proxy.sendChat<SendMessageResult>(
      CHAT_PATTERNS.POST_INCOMING_WEBHOOK,
      {
        token,
        text: dto.text,
        username: dto.username,
      },
      { skipTenant: true },
    );
    const { recipientIds, ...message } = result;
    this.chatGateway.broadcastMessage(message, recipientIds);
    void this.proxy.sendChat(
      CHAT_PATTERNS.DISPATCH_OUTGOING_WEBHOOKS,
      {
        conversationId: message.conversationId,
        event: 'message.created' as const,
        message: {
          id: message.id,
          body: message.body ?? null,
          senderId: message.senderId,
          type: message.type,
          createdAt: message.createdAt,
          botUsername: message.botUsername ?? null,
        },
      },
      { skipTenant: true },
    );
    return { message: 'ok', data: { id: message.id } };
  }
}
