import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PaginatedResult } from '@app/common';
import { CHAT_PATTERNS } from '@app/contracts';
import type { ConversationView, MessageView } from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';

type ChatMessageParam = { role: 'system' | 'user' | 'assistant'; content: string };

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly config: ConfigService,
  ) {}

  /**
   * Shared LLM call. Prefers Ollama (local) when configured, then OpenAI.
   * Set AI_PROVIDER=ollama|openai|auto (default auto).
   */
  private async chatComplete(opts: {
    messages: ChatMessageParam[];
    temperature?: number;
  }): Promise<{ content: string; provider: 'ollama' | 'openai' } | null> {
    const preferred = (
      this.config.get<string>('AI_PROVIDER') || 'auto'
    )
      .trim()
      .toLowerCase();
    const ollamaBase = (
      this.config.get<string>('OLLAMA_BASE_URL') || 'http://127.0.0.1:11434'
    ).replace(/\/$/, '');
    const ollamaModel =
      this.config.get<string>('OLLAMA_MODEL')?.trim() || 'llama3.2';
    const openaiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    const openaiModel =
      this.config.get<string>('OPENAI_MODEL')?.trim() || 'gpt-4o-mini';

    const tryOllama =
      preferred === 'ollama' ||
      preferred === 'auto' ||
      (!openaiKey && preferred !== 'openai');
    const tryOpenAi =
      Boolean(openaiKey) &&
      (preferred === 'openai' || preferred === 'auto' || preferred === 'ollama');

    if (tryOllama) {
      try {
        const response = await fetch(`${ollamaBase}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: ollamaModel,
            temperature: opts.temperature ?? 0.3,
            messages: opts.messages,
          }),
        });
        if (response.ok) {
          const payload = (await response.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const content = payload.choices?.[0]?.message?.content?.trim();
          if (content) {
            return { content, provider: 'ollama' };
          }
        } else {
          this.logger.debug(
            `Ollama chat failed: ${response.status} ${response.statusText}`,
          );
        }
      } catch (err) {
        this.logger.debug(
          `Ollama unreachable: ${
            err instanceof Error ? err.message : 'unknown'
          }`,
        );
      }
    }

    if (tryOpenAi && openaiKey) {
      try {
        const response = await fetch(
          'https://api.openai.com/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${openaiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: openaiModel,
              temperature: opts.temperature ?? 0.3,
              messages: opts.messages,
            }),
          },
        );
        if (response.ok) {
          const payload = (await response.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const content = payload.choices?.[0]?.message?.content?.trim();
          if (content) {
            return { content, provider: 'openai' };
          }
        }
      } catch {
        // fall through
      }
    }

    return null;
  }

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
    const ai = await this.chatComplete({
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content:
            'Summarize this team chat in 3-5 concise bullet points. Focus on decisions, asks, and next steps.',
        },
        { role: 'user', content: transcript },
      ],
    });
    if (ai?.content) {
      return { summary: ai.content, poweredByAi: true };
    }

    const recent = lines.slice(-6);
    return {
      summary: `Recent highlights:\n${recent.join('\n')}`,
      poweredByAi: false,
    };
  }

  /**
   * Slack-style "Catch me up" — summarize only messages since the actor last read.
   * Pass `sinceOverride` from the client (captured before mark-seen) so the window
   * stays correct after opening the channel.
   */
  async catchMeUp(
    actorId: string,
    conversationId: string,
    sinceOverride?: string | null,
  ): Promise<{
    summary: string;
    poweredByAi: boolean;
    messageCount: number;
    firstUnreadMessageId: string | null;
    since: string | null;
  }> {
    const conversation = await this.proxy.sendChat<{
      lastReadAt: string | null;
      unreadCount?: number;
      members: Array<{ userId: string; lastReadAt: string | null }>;
    }>(CHAT_PATTERNS.GET_CONVERSATION, { actorId, conversationId });

    const membership = conversation.members?.find(
      (member) => member.userId === actorId,
    );
    const sinceRaw =
      (sinceOverride && String(sinceOverride).trim()) ||
      membership?.lastReadAt ||
      conversation.lastReadAt ||
      null;
    const sinceMs = sinceRaw ? Date.parse(sinceRaw) : NaN;

    const history = await this.proxy.sendChat<PaginatedResult<MessageView>>(
      CHAT_PATTERNS.LIST_MESSAGES,
      { actorId, conversationId, page: 1, limit: 80 },
    );

    const chronological = [...history.items]
      .reverse()
      .filter(
        (message) =>
          !message.deletedForEveryone &&
          !message.threadRootId &&
          message.type !== 'call',
      );

    let unread = Number.isFinite(sinceMs)
      ? chronological.filter(
          (message) => Date.parse(message.createdAt) > sinceMs,
        )
      : chronological.slice(
          -Math.max(1, Number(conversation.unreadCount) || 12),
        );

    // Prefer messages from others; fall back to all unread if empty.
    const fromOthers = unread.filter((message) => message.senderId !== actorId);
    if (fromOthers.length > 0) {
      unread = fromOthers;
    }

    if (unread.length === 0) {
      return {
        summary:
          'You’re caught up — no unread messages since you last read this channel.',
        poweredByAi: false,
        messageCount: 0,
        firstUnreadMessageId: null,
        since: sinceRaw,
      };
    }

    const lines = unread
      .filter((message) => Boolean(message.body?.trim()) || message.attachment)
      .map((message) => {
        const body =
          message.body?.trim() ||
          (message.attachment
            ? `[file: ${message.attachment.name || 'attachment'}]`
            : '');
        return `- ${body}`;
      })
      .filter((line) => line !== '- ');

    const firstUnreadMessageId = unread[0]?.id ?? null;
    const transcript = lines.join('\n').slice(0, 7000);

    if (lines.length > 0) {
      const ai = await this.chatComplete({
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content:
              'You help someone catch up on unread team chat. Write 3-5 short bullet points covering: what happened, decisions, questions/asks for them, and next steps. Be concrete. No preamble.',
          },
          {
            role: 'user',
            content: `Unread messages (${unread.length}):\n${transcript}`,
          },
        ],
      });
      if (ai?.content) {
        return {
          summary: ai.content,
          poweredByAi: true,
          messageCount: unread.length,
          firstUnreadMessageId,
          since: sinceRaw,
        };
      }
    }

    const highlights = lines.slice(0, 8);
    return {
      summary:
        highlights.length > 0
          ? `While you were away (${unread.length} unread):\n${highlights.join('\n')}`
          : `You have ${unread.length} unread message(s). Open the channel to review them.`,
      poweredByAi: false,
      messageCount: unread.length,
      firstUnreadMessageId,
      since: sinceRaw,
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
    const ai = await this.chatComplete({
      temperature: 0.6,
      messages: [
        {
          role: 'system',
          content:
            'Suggest exactly 3 short chat reply options for a team messenger. Return JSON only: {"replies":["...","...","..."]}. Each reply max 40 characters. No numbering or quotes inside replies.',
        },
        { role: 'user', content: `Incoming message:\n${text.slice(0, 500)}` },
      ],
    });
    if (ai?.content) {
      const jsonMatch = ai.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as { replies?: unknown };
          const replies = (Array.isArray(parsed.replies) ? parsed.replies : [])
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 3);
          if (replies.length > 0) {
            return { replies, poweredByAi: true };
          }
        } catch {
          // heuristic below
        }
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
    const ai = await this.chatComplete({
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: `Translate the user message into language code "${lang}". Return JSON only: {"translatedText":"...","detectedLanguage":"xx"}. Keep meaning; do not add commentary.`,
        },
        { role: 'user', content: text.slice(0, 4000) },
      ],
    });
    if (ai?.content) {
      const jsonMatch = ai.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as {
            translatedText?: unknown;
            detectedLanguage?: unknown;
          };
          if (
            typeof parsed.translatedText === 'string' &&
            parsed.translatedText.trim()
          ) {
            return {
              translatedText: parsed.translatedText.trim(),
              detectedLanguage:
                typeof parsed.detectedLanguage === 'string'
                  ? parsed.detectedLanguage
                  : null,
              poweredByAi: true,
            };
          }
        } catch {
          // fall through
        }
      }
    }

    return {
      translatedText: `[${lang}] ${text}`,
      detectedLanguage: null,
      poweredByAi: false,
    };
  }

  /**
   * Ask Relay — hybrid RAG: FTS retrieve → LLM answer with citations.
   * Mention-style questions use the mentions index (not keyword search).
   * Without a running LLM, returns a ranked excerpt digest.
   */
  async askRelay(
    actorId: string,
    question: string,
    conversationId?: string | null,
  ): Promise<{
    answer: string;
    poweredByAi: boolean;
    citations: Array<{
      messageId: string;
      conversationId: string;
      conversationName: string | null;
      conversationType: 'private' | 'group';
      bodySnippet: string;
      createdAt: string;
    }>;
  }> {
    const cleaned = question.trim().replace(/^\?+\s*/, '').slice(0, 500);
    if (cleaned.length < 3) {
      return {
        answer: 'Ask a longer question about your workspace messages.',
        poweredByAi: false,
        citations: [],
      };
    }

    type Hit = {
      message: {
        id: string;
        body: string;
        createdAt: string;
        deletedForEveryone?: boolean;
      };
      conversation: {
        id: string;
        type: 'private' | 'group';
        name: string | null;
      };
    };

    let hits: Hit[] = [];
    const askingAboutMyMentions = isMyMentionsQuestion(cleaned);

    if (askingAboutMyMentions && !conversationId) {
      type MentionHit = {
        conversationId: string;
        conversationName: string | null;
        conversationType: 'private' | 'group';
        message: {
          id: string;
          body: string;
          createdAt: string;
          deletedForEveryone?: boolean;
        };
      };
      try {
        const page = await this.proxy.sendChat<PaginatedResult<MentionHit>>(
          CHAT_PATTERNS.LIST_MY_MENTIONS,
          {
            actorId,
            page: 1,
            limit: 16,
            unreadOnly: false,
          },
        );
        hits = (page.items ?? [])
          .filter(
            (item) =>
              !item.message?.deletedForEveryone &&
              Boolean(item.message?.body?.trim()),
          )
          .map((item) => ({
            message: item.message,
            conversation: {
              id: item.conversationId,
              type: item.conversationType,
              name: item.conversationName,
            },
          }));
      } catch (err) {
        this.logger.debug(
          `Ask Relay mentions lookup failed: ${
            err instanceof Error ? err.message : 'unknown'
          }`,
        );
      }
    }

    if (hits.length === 0) {
      const searchQuery = askingAboutMyMentions
        ? `@${actorId}`
        : keywordsFromQuestion(cleaned);
      if (conversationId) {
        const page = await this.proxy.sendChat<
          PaginatedResult<{
            id: string;
            body: string;
            createdAt: string;
            deletedForEveryone?: boolean;
            conversationId?: string;
          }>
        >(CHAT_PATTERNS.SEARCH_MESSAGES, {
          actorId,
          conversationId,
          query: searchQuery,
          page: 1,
          limit: 16,
        });
        hits = (page.items ?? [])
          .filter((item) => !item.deletedForEveryone && item.body?.trim())
          .map((item) => ({
            message: item,
            conversation: {
              id: conversationId,
              type: 'group' as const,
              name: null,
            },
          }));
      } else if (!askingAboutMyMentions) {
        const page = await this.proxy.sendChat<PaginatedResult<Hit>>(
          CHAT_PATTERNS.SEARCH_GLOBAL,
          {
            actorId,
            query: searchQuery,
            page: 1,
            limit: 16,
          },
        );
        hits = (page.items ?? []).filter(
          (item) =>
            !item.message?.deletedForEveryone &&
            Boolean(item.message?.body?.trim()),
        );
      }
    }

    const citations = hits.slice(0, 8).map((hit) => ({
      messageId: hit.message.id,
      conversationId: hit.conversation.id,
      conversationName: hit.conversation.name ?? null,
      conversationType: hit.conversation.type,
      bodySnippet: hit.message.body.trim().slice(0, 220),
      createdAt: hit.message.createdAt,
    }));

    if (citations.length === 0) {
      return {
        answer: askingAboutMyMentions
          ? 'No one has @mentioned you in channels or DMs you can see yet. Mentions only count when someone else tags you — messages you send yourself are not included.'
          : 'No matching messages found. Try different keywords, or use Slack-style search like `from:@name` / `in:#channel`.',
        poweredByAi: false,
        citations: [],
      };
    }

    const excerpts = citations
      .map(
        (item, index) =>
          `[${index + 1}] (${item.conversationName ? `#${item.conversationName}` : 'chat'}) ${item.bodySnippet}`,
      )
      .join('\n');

    const ai = await this.chatComplete({
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: askingAboutMyMentions
            ? 'You answer who @mentioned the user in their workspace using ONLY the numbered chat excerpts (each excerpt is a message that tagged them). Return JSON only: {"answer":"2-5 sentences naming channels/people when possible","citations":[1,3]} where citations are 1-based excerpt numbers you used. Do not invent facts.'
            : 'You answer questions about a team workspace using ONLY the numbered chat excerpts. Return JSON only: {"answer":"2-5 sentences","citations":[1,3]} where citations are 1-based excerpt numbers you used. If the excerpts are insufficient, say so clearly and still cite anything relevant. Do not invent facts.',
        },
        {
          role: 'user',
          content: `Question: ${cleaned}\n\nExcerpts:\n${excerpts}`,
        },
      ],
    });
    if (ai?.content) {
      const jsonMatch = ai.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as {
            answer?: unknown;
            citations?: unknown;
          };
          if (typeof parsed.answer === 'string' && parsed.answer.trim()) {
            const indexes = Array.isArray(parsed.citations)
              ? parsed.citations
                  .map((n) => Number(n))
                  .filter(
                    (n) =>
                      Number.isFinite(n) && n >= 1 && n <= citations.length,
                  )
              : [];
            const selected =
              indexes.length > 0
                ? [...new Set(indexes)].map((n) => citations[n - 1])
                : citations.slice(0, 5);
            return {
              answer: parsed.answer.trim(),
              poweredByAi: true,
              citations: selected,
            };
          }
        } catch {
          // heuristic below
        }
      }
    }

    if (askingAboutMyMentions) {
      const digest = citations
        .slice(0, 5)
        .map(
          (item, index) =>
            `${index + 1}. ${item.bodySnippet}${
              item.conversationName ? ` — #${item.conversationName}` : ''
            }`,
        )
        .join('\n');
      return {
        answer: `Recent messages that @mentioned you:\n${digest}`,
        poweredByAi: false,
        citations: citations.slice(0, 5),
      };
    }

    const digest = citations
      .slice(0, 5)
      .map(
        (item, index) =>
          `${index + 1}. ${item.bodySnippet}${
            item.conversationName ? ` — #${item.conversationName}` : ''
          }`,
      )
      .join('\n');
    return {
      answer: `Top matches for “${cleaned}”:\n${digest}`,
      poweredByAi: false,
      citations: citations.slice(0, 5),
    };
  }

  /**
   * Cross-channel morning digest — unread channels/DMs with deep links.
   */
  async dailyDigest(actorId: string): Promise<{
    generatedAt: string;
    poweredByAi: boolean;
    overview: string;
    sections: Array<{
      conversationId: string;
      conversationName: string;
      conversationType: 'private' | 'group';
      unreadCount: number;
      summary: string;
      firstUnreadMessageId: string | null;
      deepLink: string;
    }>;
  }> {
    const page = await this.proxy.sendChat<PaginatedResult<ConversationView>>(
      CHAT_PATTERNS.LIST_CONVERSATIONS,
      { actorId, page: 1, limit: 80 },
    );
    const unreadConversations = (page.items ?? [])
      .filter((item) => (item.unreadCount ?? 0) > 0 || item.hasUnreadMention)
      .sort((a, b) => (b.unreadCount ?? 0) - (a.unreadCount ?? 0))
      .slice(0, 8);

    if (unreadConversations.length === 0) {
      return {
        generatedAt: new Date().toISOString(),
        poweredByAi: false,
        overview: 'You’re fully caught up — no unread channels or DMs.',
        sections: [],
      };
    }

    const sections: Array<{
      conversationId: string;
      conversationName: string;
      conversationType: 'private' | 'group';
      unreadCount: number;
      summary: string;
      firstUnreadMessageId: string | null;
      deepLink: string;
    }> = [];

    let anyAi = false;
    for (const conversation of unreadConversations) {
      const catchUp = await this.catchMeUp(actorId, conversation.id);
      if (catchUp.poweredByAi) anyAi = true;
      const name =
        conversation.type === 'group'
          ? `#${(conversation.name || 'channel').replace(/^#/, '')}`
          : conversation.name?.trim() || 'Direct message';
      const firstId = catchUp.firstUnreadMessageId;
      sections.push({
        conversationId: conversation.id,
        conversationName: name,
        conversationType: conversation.type as 'private' | 'group',
        unreadCount: Math.max(
          conversation.unreadCount ?? 0,
          catchUp.messageCount,
        ),
        summary: catchUp.summary,
        firstUnreadMessageId: firstId,
        deepLink: firstId
          ? `/chat/${conversation.id}?focus=${encodeURIComponent(firstId)}`
          : `/chat/${conversation.id}`,
      });
    }

    const sketch = sections
      .map(
        (section) =>
          `- ${section.conversationName} (${section.unreadCount} unread): ${section.summary
            .replace(/\n/g, ' ')
            .slice(0, 180)}`,
      )
      .join('\n');

    const ai = await this.chatComplete({
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content:
            'Write a short morning digest (4-7 bullets) across unread team chats. Group by priority: decisions, asks for the reader, and FYIs. Be concrete. No preamble.',
        },
        {
          role: 'user',
          content: `Unread channels:\n${sketch}`,
        },
      ],
    });

    return {
      generatedAt: new Date().toISOString(),
      poweredByAi: Boolean(ai?.content) || anyAi,
      overview:
        ai?.content ||
        `You have unread activity in ${sections.length} conversation${
          sections.length === 1 ? '' : 's'
        }. Open each section below to jump in.`,
      sections,
    };
  }
}

function isMyMentionsQuestion(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /\b(who|anyone|somebody|someone)\b.{0,40}\b(mention(ed|s|ing)?|tagged|pinged)\b.{0,20}\b(me|my)\b/.test(
      q,
    ) ||
    /\b(mention(ed|s|ing)?|tagged|pinged)\b.{0,20}\b(me|my)\b/.test(q) ||
    /\bmy\s+(mentions?|tags?|pings?)\b/.test(q) ||
    /\b(@me|mentions?\s+of\s+me)\b/.test(q)
  );
}

function keywordsFromQuestion(question: string): string {
  const stop = new Set([
    'what',
    'when',
    'where',
    'who',
    'why',
    'how',
    'the',
    'a',
    'an',
    'is',
    'are',
    'was',
    'were',
    'did',
    'do',
    'does',
    'about',
    'for',
    'to',
    'of',
    'in',
    'on',
    'and',
    'or',
    'me',
    'us',
    'we',
    'you',
    'they',
    'that',
    'this',
    'with',
    'from',
    'please',
    'tell',
    'find',
    'show',
    'any',
    'our',
    'your',
    'can',
    'could',
    'would',
    'should',
  ]);
  const tokens = question
    .replace(/[?!.,;:()"']/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length > 2 && !stop.has(token.toLowerCase()),
    )
    .slice(0, 10);
  return tokens.join(' ') || question.slice(0, 80);
}
