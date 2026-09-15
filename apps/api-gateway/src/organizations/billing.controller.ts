import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '@app/common';
import { AUTH_PATTERNS } from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { SkipOrg } from '../organizations/skip-org.decorator';

@ApiTags('Billing')
@Controller('billing')
@SkipOrg()
export class BillingController {
  constructor(private readonly proxy: MicroserviceProxy) {}

  @Public()
  @Post('stripe/webhook')
  @HttpCode(HttpStatus.OK)
  async stripeWebhook(
    @Req() req: { rawBody?: Buffer; body?: Record<string, unknown> },
    @Headers('stripe-signature') signature: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const rawBody =
      req.rawBody?.toString('utf8') ??
      (body ? JSON.stringify(body) : undefined);

    const data = await this.proxy.sendAuth(
      AUTH_PATTERNS.HANDLE_STRIPE_WEBHOOK,
      {
        rawBody,
        signature,
        type: typeof body?.type === 'string' ? body.type : undefined,
        data:
          body?.data && typeof body.data === 'object'
            ? (body.data as Record<string, unknown>)
            : body,
      },
      { skipTenant: true },
    );
    return { message: 'Webhook received', data };
  }
}
