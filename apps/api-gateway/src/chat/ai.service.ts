import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PaginatedResult } from '@app/common';
import { CHAT_PATTERNS } from '@app/contracts';
import type { MessageView } from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';

@Injectable()
export class AiService {
  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly config: ConfigService,
  ) {}

  async summarizeConversation(
    actorId: string,
    conversationId: string,
  ): Promise<{ summary: string; poweredByAi: boolean }> {
    const history = await this.proxy.sendChat<PaginatedResult<MessageView>>(
      CHAT_PATTERNS.LIST_MESSAGES,
      { actorId, conversationId, page: 1, limit: 40 },
    );
    const lines = [...history.items]
      .reverse()
      .filter((message) => !message.deletedForEveryone && message.body.trim())
      .map((message) => `- ${message.body.trim()}`);

    if (lines.length === 0) {
      return { summary: 'No messages to summarize yet.', poweredByAi: false };
    }

    const transcript = lines.join('\n').slice(0, 6000);
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();

    if (apiKey) {
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini'),
            temperature: 0.3,
            messages: [
              {
                role: 'system',
                content:
                  'Summarize this team chat in 3-5 concise bullet points. Focus on decisions, asks, and next steps.',
              },
              { role: 'user', content: transcript },
            ],
          }),
        });
        if (response.ok) {
          const payload = (await response.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const summary = payload.choices?.[0]?.message?.content?.trim();
          if (summary) {
            return { summary, poweredByAi: true };
          }
        }
      } catch {
        // fall through to heuristic summary
      }
    }

    const recent = lines.slice(-6);
    return {
      summary: `Recent highlights:\n${recent.join('\n')}`,
      poweredByAi: false,
    };
  }

  async smartReplies(
    actorId: string,
    conversationId: string,
  ): Promise<{ replies: string[] }> {
    const history = await this.proxy.sendChat<PaginatedResult<MessageView>>(
      CHAT_PATTERNS.LIST_MESSAGES,
      { actorId, conversationId, page: 1, limit: 12 },
    );
    const lastIncoming = [...history.items].find(
      (message) => message.senderId !== actorId && !message.deletedForEveryone,
    );
    const text = lastIncoming?.body?.toLowerCase() ?? '';

    if (text.includes('?')) {
      return { replies: ['Yes, sounds good', 'Let me check', 'Not sure yet'] };
    }
    if (text.includes('thanks') || text.includes('thank you')) {
      return { replies: ['You’re welcome!', 'Anytime', 'Happy to help'] };
    }
    if (text.includes('meet') || text.includes('call')) {
      return { replies: ['Works for me', 'What time?', 'Can we do async?'] };
    }
    return { replies: ['On it 👍', 'Got it', 'Will follow up'] };
  }
}
