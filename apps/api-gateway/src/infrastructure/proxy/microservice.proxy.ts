import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import {
  AUTH_SERVICE,
  CHAT_SERVICE,
  GatewayTimeoutAppException,
  InflightLimiter,
  USER_SERVICE,
} from '@app/common';
import { getGatewayTenant, tenantRpcFields } from '../../organizations/tenant-context';

type SendOptions = {
  /** Do not attach organization tenant fields (auth / org APIs). */
  skipTenant?: boolean;
};

@Injectable()
export class MicroserviceProxy implements OnModuleInit {
  private readonly logger = new Logger(MicroserviceProxy.name);
  private readonly limiter: InflightLimiter;
  private readonly rpcTimeoutMs: number;

  constructor(
    @Inject(AUTH_SERVICE) private readonly authClient: ClientProxy,
    @Inject(USER_SERVICE) private readonly userClient: ClientProxy,
    @Inject(CHAT_SERVICE) private readonly chatClient: ClientProxy,
    config: ConfigService,
  ) {
    this.limiter = new InflightLimiter(
      config.get<number>('GATEWAY_MAX_INFLIGHT', 2_000),
    );
    this.rpcTimeoutMs = Math.min(
      config.get<number>('GATEWAY_TIMEOUT_MS', 10_000),
      8_000,
    );
  }

  async onModuleInit(): Promise<void> {
    try {
      await Promise.race([
        Promise.all([
          this.authClient.connect(),
          this.userClient.connect(),
          this.chatClient.connect(),
        ]),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('connect timed out')), 5_000);
        }),
      ]);
      this.logger.log('RabbitMQ clients connected');
    } catch (error) {
      this.logger.error(
        `RabbitMQ clients did not connect: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  sendAuth<TResult, TInput = unknown>(
    pattern: string,
    payload: TInput,
    options?: SendOptions,
  ): Promise<TResult> {
    return this.send(this.authClient, pattern, payload, {
      skipTenant: true,
      ...options,
    });
  }

  sendUser<TResult, TInput = unknown>(
    pattern: string,
    payload: TInput,
    options?: SendOptions,
  ): Promise<TResult> {
    return this.send(this.userClient, pattern, payload, options);
  }

  sendChat<TResult, TInput = unknown>(
    pattern: string,
    payload: TInput,
    options?: SendOptions,
  ): Promise<TResult> {
    return this.send(this.chatClient, pattern, payload, options);
  }

  private async send<TResult, TInput>(
    client: ClientProxy,
    pattern: string,
    payload: TInput,
    options?: SendOptions,
  ): Promise<TResult> {
    const tenant = options?.skipTenant ? undefined : getGatewayTenant();
    const enriched = {
      ...(typeof payload === 'object' && payload !== null ? payload : { value: payload }),
      ...tenantRpcFields(tenant),
    } as TInput;

    await this.limiter.acquire();
    try {
      return await firstValueFrom(
        client
          .send<TResult, TInput>(pattern, enriched)
          .pipe(timeout(this.rpcTimeoutMs)),
      );
    } catch (error) {
      if (this.isTimeout(error)) {
        throw new GatewayTimeoutAppException(
          'The upstream service did not respond in time',
        );
      }
      throw new RpcException(this.asRpcPayload(error));
    } finally {
      this.limiter.release();
    }
  }

  private isTimeout(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: string }).name === 'TimeoutError'
    );
  }

  private asRpcPayload(error: unknown): Record<string, unknown> {
    if (error instanceof RpcException) {
      const inner = error.getError();
      return typeof inner === 'object' && inner !== null
        ? (inner as Record<string, unknown>)
        : {
            statusCode: 500,
            message: String(inner),
            error: 'Internal Server Error',
          };
    }

    if (typeof error === 'object' && error !== null) {
      const record = error as Record<string, unknown>;
      if (
        typeof record.statusCode === 'number' &&
        typeof record.message === 'string'
      ) {
        return record;
      }
      if (typeof record.message === 'object' && record.message !== null) {
        return record.message as Record<string, unknown>;
      }
    }

    return {
      statusCode: 500,
      message: 'An unexpected error occurred on the server',
      error: 'Internal Server Error',
    };
  }
}
