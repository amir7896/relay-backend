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
  ): Promise<{ replies: string[]; poweredByAi: boolean }> {
    const history = await this.proxy.sendChat<PaginatedResult<MessageView>>(
      CHAT_PATTERNS.LIST_MESSAGES,
      { actorId, conversationId, page: 1, limit: 12 },
    );
    const lastIncoming = [...history.items].find(
      (message) =>
        message.senderId !== actorId &&
        !message.deletedForEveryone &&
        Boolean(message.body?.trim()),
    );
    if (!lastIncoming) {
      return { replies: [], poweredByAi: false };
    }

    const text = lastIncoming.body.trim();
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (apiKey) {
      try {
        const response = await fetch(
          'https://api.openai.com/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini'),
              temperature: 0.6,
              messages: [
                {
                  role: 'system',
                  content:
                    'Suggest exactly 3 short chat reply options for a team messenger. Return JSON only: {"replies":["...","...","..."]}. Each reply max 40 characters. No numbering or quotes inside replies.',
                },
                { role: 'user', content: `Incoming message:\n${text.slice(0, 500)}` },
              ],
            }),
          },
        );
        if (response.ok) {
          const payload = (await response.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const raw = payload.choices?.[0]?.message?.content?.trim() ?? '';
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]) as { replies?: unknown };
            const replies = (Array.isArray(parsed.replies) ? parsed.replies : [])
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.trim())
              .filter(Boolean)
              .slice(0, 3);
            if (replies.length > 0) {
              return { replies, poweredByAi: true };
            }
          }
        }
      } catch {
        // fall through to heuristic replies
      }
    }

    const lower = text.toLowerCase();
    if (lower.includes('?')) {
      return {
        replies: ['Yes, sounds good', 'Let me check', 'Not sure yet'],
        poweredByAi: false,
      };
    }
    if (lower.includes('thanks') || lower.includes('thank you')) {
      return {
        replies: ["You're welcome!", 'Anytime', 'Happy to help'],
        poweredByAi: false,
      };
    }
    if (lower.includes('meet') || lower.includes('call')) {
      return {
        replies: ['Works for me', 'What time?', 'Can we do async?'],
        poweredByAi: false,
      };
    }
    return {
      replies: ['On it', 'Got it', 'Will follow up'],
      poweredByAi: false,
    };
  }

  async translateMessage(
    actorId: string,
    conversationId: string,
    messageId: string,
    targetLanguage = 'en',
  ): Promise<{
    translatedText: string;
    detectedLanguage: string | null;
    poweredByAi: boolean;
  }> {
    const message = await this.proxy.sendChat<MessageView>(
      CHAT_PATTERNS.GET_MESSAGE,
      { actorId, conversationId, messageId },
    );
    const text = message.body?.trim() ?? '';
    if (!text || message.deletedForEveryone) {
      return {
        translatedText: '',
        detectedLanguage: null,
        poweredByAi: false,
      };
    }

    const lang = (targetLanguage || 'en').trim().slice(0, 16) || 'en';
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (apiKey) {
      try {
        const response = await fetch(
          'https://api.openai.com/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini'),
              temperature: 0.2,
              messages: [
                {
                  role: 'system',
                  content: `Translate the user message into language code "${lang}". Return JSON only: {"translatedText":"...","detectedLanguage":"xx"}. Keep meaning; do not add commentary.`,
                },
                { role: 'user', content: text.slice(0, 4000) },
              ],
            }),
          },
        );
        if (response.ok) {
          const payload = (await response.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const raw = payload.choices?.[0]?.message?.content?.trim() ?? '';
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]) as {
              translatedText?: unknown;
              detectedLanguage?: unknown;
            };
            if (typeof parsed.translatedText === 'string' && parsed.translatedText.trim()) {
              return {
                translatedText: parsed.translatedText.trim(),
                detectedLanguage:
                  typeof parsed.detectedLanguage === 'string'
                    ? parsed.detectedLanguage
                    : null,
                poweredByAi: true,
              };
            }
          }
        }
      } catch {
        // fall through
      }
    }

    return {
      translatedText: `[${lang}] ${text}`,
      detectedLanguage: null,
      poweredByAi: false,
    };
  }
}
