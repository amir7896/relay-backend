import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  AuthenticatedUser,
  BadRequestAppException,
  CurrentUser,
  ParseUuidPipe,
  Public,
} from '@app/common';
import { CHAT_PATTERNS } from '@app/contracts';
import type { CreateAppIssueResult } from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { ChatGateway } from './chat.gateway';
import { AppOauthService } from './app-oauth.service';
import { SkipOrg } from '../organizations/skip-org.decorator';
import { getGatewayTenant } from '../organizations/tenant-context';

@Controller('chat')
export class IntegrationsController {
  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly oauth: AppOauthService,
    private readonly chatGateway: ChatGateway,
  ) {}

  private payload(user: AuthenticatedUser, extra: Record<string, unknown> = {}) {
    return { actorId: user.id, ...extra };
  }

  @Get('apps/:appKey/oauth/start')
  async oauthStart(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appKey') appKey: string,
    @Query('returnPath') returnPath?: string,
  ) {
    const tenant = getGatewayTenant();
    if (!tenant?.id) {
      throw new BadRequestAppException('X-Organization-Id is required');
    }
    const data = await this.oauth.start({
      appKey,
      organizationId: tenant.id,
      actorId: user.id,
      returnPath,
    });
    return { message: 'OAuth authorize URL ready', data };
  }

  @Public()
  @SkipOrg()
  @Get('apps/oauth/callback')
  async oauthCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const redirect = await this.oauth.handleCallback({ code, state, error });
    return res.redirect(redirect);
  }

  @Get('apps/:appKey/oauth/status')
  async oauthStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appKey') appKey: string,
  ) {
    const data = await this.proxy.sendChat(
      CHAT_PATTERNS.GET_APP_OAUTH_STATUS,
      this.payload(user, { appKey }),
    );
    return { message: 'Integration status', data };
  }

  @Delete('apps/:appKey/oauth')
  async disconnect(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appKey') appKey: string,
  ) {
    const data = await this.proxy.sendChat(
      CHAT_PATTERNS.DISCONNECT_APP_OAUTH,
      this.payload(user, { appKey }),
    );
    return { message: 'Integration disconnected', data };
  }

  @Get('apps/:appKey/projects')
  async projects(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appKey') appKey: string,
  ) {
    const data = await this.proxy.sendChat(
      CHAT_PATTERNS.LIST_APP_PROJECTS,
      this.payload(user, { appKey }),
    );
    return { message: 'Projects retrieved', data };
  }

  @Post('conversations/:id/apps/:appKey/issues')
  async createIssue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('appKey') appKey: string,
    @Body() body: Record<string, unknown>,
  ) {
    if (appKey !== 'github' && appKey !== 'jira') {
      throw new BadRequestAppException(
        'Only github and jira support create-from-message',
      );
    }
    const messageId = String(body.messageId || '').trim();
    const listId = String(body.listId || '').trim();
    const itemId = String(body.itemId || '').trim();

    if (listId && itemId) {
      if (appKey !== 'jira') {
        throw new BadRequestAppException('Only Jira supports push-from-list');
      }
      const result = (await this.proxy.sendChat(
        CHAT_PATTERNS.CREATE_APP_ISSUE_FROM_LIST_ITEM,
        this.payload(user, {
          conversationId: id,
          listId,
          itemId,
          appKey,
          title: body.title,
          body: body.body,
          projectKey: body.projectKey,
        }),
      )) as CreateAppIssueResult & {
        item?: Record<string, unknown>;
        alreadyLinked?: boolean;
      };

      if (result.message) {
        const { recipientIds, ...view } = result.message as {
          recipientIds?: string[];
        } & Record<string, unknown>;
        this.chatGateway.broadcastMessage(view as any, recipientIds ?? []);
      }

      return {
        message: result.alreadyLinked
          ? 'Already linked to Jira'
          : 'Issue created from list item',
        data: result,
      };
    }

    if (!messageId) throw new BadRequestAppException('messageId is required');

    const result = (await this.proxy.sendChat(
      CHAT_PATTERNS.CREATE_APP_ISSUE_FROM_MESSAGE,
      this.payload(user, {
        conversationId: id,
        messageId,
        appKey,
        title: body.title,
        body: body.body,
        projectKey: body.projectKey,
        repo: body.repo,
      }),
    )) as CreateAppIssueResult;

    if (result.message) {
      const { recipientIds, ...view } = result.message as {
        recipientIds?: string[];
      } & Record<string, unknown>;
      this.chatGateway.broadcastMessage(view as any, recipientIds ?? []);
    }

    return { message: 'Issue created', data: result };
  }

  @Post('conversations/:id/apps/zoom/meetings')
  async zoomMeeting(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const result = (await this.proxy.sendChat(
      CHAT_PATTERNS.CREATE_ZOOM_MEETING,
      this.payload(user, {
        conversationId: id,
        topic: body.topic,
      }),
    )) as CreateAppIssueResult;

    if (result.message) {
      const { recipientIds, ...view } = result.message as {
        recipientIds?: string[];
      } & Record<string, unknown>;
      this.chatGateway.broadcastMessage(view as any, recipientIds ?? []);
    }

    return { message: 'Zoom meeting created', data: result };
  }

  @Post('conversations/:id/apps/:appKey/events/demo')
  async demoAppEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Param('appKey') appKey: string,
    @Body() body: Record<string, unknown>,
  ) {
    const key = String(appKey || '').trim().toLowerCase();
    if (key !== 'github' && key !== 'jira') {
      throw new BadRequestAppException(
        'Demo events are only available for GitHub and Jira',
      );
    }
    const result = (await this.proxy.sendChat(
      CHAT_PATTERNS.DEMO_APP_EVENT,
      this.payload(user, {
        conversationId: id,
        appKey: key,
        kind: body.kind,
      }),
    )) as {
      posted?: boolean;
      ignored?: boolean;
      reason?: string;
      conversationId?: string;
      message?: Record<string, unknown> & {
        conversationId: string;
        recipientIds?: string[];
      };
    };

    if (result?.ignored) {
      throw new BadRequestAppException(
        result.reason === 'no_events_channel'
          ? 'Pick an events channel in Settings first'
          : `Could not post demo event (${result.reason || 'ignored'})`,
      );
    }

    if (result?.message) {
      const { recipientIds, ...view } = result.message;
      this.chatGateway.broadcastMessage(view as any, recipientIds ?? []);
    }

    return {
      message:
        key === 'jira'
          ? 'Demo Jira event posted to the events channel'
          : 'Demo GitHub event posted to the events channel',
      data: result,
    };
  }

  @Public()
  @SkipOrg()
  @Post('integrations/:appKey/events')
  async ingestEvent(
    @Param('appKey') appKey: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Headers('x-github-event') githubEvent: string | undefined,
    @Headers('x-atlassian-webhook-identifier') jiraEvent: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const orgId =
      organizationId ||
      String(body.organizationId || body.orgId || '').trim();
    if (!orgId) {
      throw new BadRequestAppException(
        'Pass X-Organization-Id (or organizationId in body) for event routing',
      );
    }
    const eventType =
      githubEvent ||
      jiraEvent ||
      String(body.webhookEvent || body.eventType || 'event');

    const result = (await this.proxy.sendChat(
      CHAT_PATTERNS.INGEST_APP_EVENT,
      {
        appKey,
        organizationId: orgId,
        eventType,
        payload: body,
      },
      { skipTenant: true },
    )) as {
      posted?: boolean;
      message?: Record<string, unknown> & {
        conversationId: string;
        recipientIds?: string[];
      };
    };

    if (result?.message) {
      const { recipientIds, ...view } = result.message;
      this.chatGateway.broadcastMessage(view as any, recipientIds ?? []);
    }

    return { message: 'Event accepted', data: result };
  }
}
