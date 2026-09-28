import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PaginatedResult } from '@app/common';
import { BadRequestAppException } from '@app/common';
import { CHAT_PATTERNS } from '@app/contracts';
import type {
  ChannelCanvasView,
  ConversationView,
  MessageView,
} from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';

type ChatMessageParam = { role: 'system' | 'user' | 'assistant'; content: string };

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly config: ConfigService,
  ) {}

  /** RELAY_DEMO_MODE or DEMO_AI — polished answers without Ollama/OpenAI. */
  private isDemoAi(): boolean {
    return this.envFlag('DEMO_AI', true);
  }

  private isRelayDemoMode(): boolean {
    return this.envFlag('RELAY_DEMO_MODE', false);
  }

  private envFlag(name: string, followDemoMode: boolean): boolean {
    const raw = this.config.get<string>(name)?.trim().toLowerCase();
    if (raw === 'true' || raw === '1' || raw === 'yes') return true;
    if (raw === 'false' || raw === '0' || raw === 'no') return false;
    return followDemoMode ? this.isRelayDemoMode() : false;
  }

  private demoSummarizeLines(lines: string[], label: string): string {
    const pick = lines.slice(-8).map((line) => line.replace(/^-\s*/, '').trim()).filter(Boolean);
    if (pick.length === 0) {
      return `${label}: nothing concrete yet.`;
    }
    const bullets = pick.slice(0, 5).map((line) => `• ${line.slice(0, 160)}`);
    return [
      `${label} (demo AI · grounded in recent messages):`,
      ...bullets,
      pick.length > 5 ? `• …and ${pick.length - 5} more` : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private demoAskFromCitations(
    question: string,
    citations: Array<{
      conversationName: string | null;
      bodySnippet: string;
    }>,
    mentionsMode: boolean,
  ): string {
    const top = citations.slice(0, 4);
    const refs = top
      .map((item, index) => {
        const where = item.conversationName
          ? `#${item.conversationName.replace(/^#/, '')}`
          : 'this channel';
        return `[${index + 1}] ${where}: “${item.bodySnippet.slice(0, 140)}”`;
      })
      .join('\n');
    if (mentionsMode) {
      return [
        `Here’s who @mentioned you recently (demo AI · grounded citations):`,
        refs,
        '',
        `Asked: “${question.slice(0, 120)}”`,
      ].join('\n');
    }
    return [
      `Based on matching workspace messages for “${question.slice(0, 120)}” (demo AI · grounded citations):`,
      refs,
      '',
      'Open a citation below to jump to the source thread.',
    ].join('\n');
  }

  /**
   * Shared LLM call. Prefers Ollama (local) when configured, then OpenAI.
   * Set AI_PROVIDER=ollama|openai|auto (default auto).
   * DEMO_AI / RELAY_DEMO_MODE skips remote calls (callers use templates).
   */
  private async chatComplete(opts: {
    messages: ChatMessageParam[];
    temperature?: number;
  }): Promise<{ content: string; provider: 'ollama' | 'openai' } | null> {
    if (this.isDemoAi()) {
      return null;
    }
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
  ): Promise<{ summary: string; poweredByAi: boolean; demoMode?: boolean }> {
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

    if (this.isDemoAi()) {
      return {
        summary: this.demoSummarizeLines(lines, 'Channel summary'),
        poweredByAi: true,
        demoMode: true,
      };
    }

    const recent = lines.slice(-6);
    return {
      summary: `Recent highlights:\n${recent.join('\n')}`,
      poweredByAi: false,
    };
  }

  /** Summarize a free-text call/huddle caption transcript into meeting notes. */
  async summarizeCallTranscript(
    transcript: string,
  ): Promise<{ summary: string; poweredByAi: boolean; demoMode?: boolean }> {
    const cleaned = String(transcript ?? '').trim().slice(0, 8000);
    if (!cleaned) {
      return { summary: 'No captions to summarize.', poweredByAi: false };
    }

    const lines = cleaned
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const ai = await this.chatComplete({
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content:
            'You turn live call captions into concise meeting notes. Output 3-6 bullet points covering decisions, action items (with owners if mentioned), and open questions. Do not invent facts.',
        },
        { role: 'user', content: cleaned },
      ],
    });
    if (ai?.content) {
      return { summary: ai.content.trim(), poweredByAi: true };
    }

    if (this.isDemoAi()) {
      return {
        summary: this.demoSummarizeLines(
          lines.map((line) => `- ${line}`),
          'Call notes',
        ),
        poweredByAi: true,
        demoMode: true,
      };
    }

    const recent = lines.slice(-6);
    return {
      summary: `Call notes:\n${recent.map((line) => `• ${line.slice(0, 160)}`).join('\n')}`,
      poweredByAi: false,
    };
  }

  /**
   * Summarize call captions and append a dated section to the channel Canvas.
   */
  async appendCallNotesToCanvas(
    actorId: string,
    conversationId: string,
    transcript: string,
  ): Promise<{
    canvas: ChannelCanvasView;
    summary: string;
    poweredByAi: boolean;
    demoMode?: boolean;
  }> {
    const cleaned = String(transcript ?? '').trim();
    if (!cleaned) {
      throw new BadRequestAppException('Transcript is required');
    }

    const existing = await this.proxy.sendChat<{
      title?: string;
      body?: string;
    }>(CHAT_PATTERNS.GET_CANVAS, { actorId, conversationId });

    const noted = await this.summarizeCallTranscript(cleaned);
    const stamp = new Date().toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const section = [
      `## Call notes · ${stamp}`,
      '',
      noted.summary.trim(),
      '',
      '_Source: live captions_',
    ].join('\n');

    const previousBody = String(existing?.body ?? '').trim();
    const nextBody = previousBody
      ? `${previousBody}\n\n---\n\n${section}`
      : section;
    const title =
      String(existing?.title ?? '').trim() || 'Channel notes';

    const canvas = await this.proxy.sendChat<ChannelCanvasView>(
      CHAT_PATTERNS.PUT_CANVAS,
      {
        actorId,
        conversationId,
        title: title.slice(0, 160),
        body: nextBody.slice(0, 100_000),
      },
    );

    return {
      canvas,
      summary: noted.summary,
      poweredByAi: noted.poweredByAi,
      demoMode: noted.demoMode,
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

    if (this.isDemoAi() && lines.length > 0) {
      return {
        summary: this.demoSummarizeLines(
          lines,
          `Catch me up · ${unread.length} unread`,
        ),
        poweredByAi: true,
        messageCount: unread.length,
        firstUnreadMessageId,
        since: sinceRaw,
      };
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

  /**
   * Channel Pulse — ambient async intelligence.
   * Turns unread activity into decisions, open loops, and blockers with
   * message anchors — not another paragraph summary.
   */
  async channelPulse(
    actorId: string,
    conversationId: string,
    sinceOverride?: string | null,
  ): Promise<{
    headline: string;
    decisions: Array<{
      text: string;
      messageId: string | null;
    }>;
    openLoops: Array<{
      text: string;
      suggestedOwner: string | null;
      messageId: string | null;
    }>;
    blockers: Array<{
      text: string;
      messageId: string | null;
    }>;
    poweredByAi: boolean;
    messageCount: number;
    firstUnreadMessageId: string | null;
    since: string | null;
  }> {
    const conversation = await this.proxy.sendChat<{
      lastReadAt: string | null;
      unreadCount?: number;
      name?: string | null;
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

    const fromOthers = unread.filter((message) => message.senderId !== actorId);
    if (fromOthers.length > 0) {
      unread = fromOthers;
    }

    const empty = {
      headline: 'You’re caught up — no pulse signals right now.',
      decisions: [] as Array<{ text: string; messageId: string | null }>,
      openLoops: [] as Array<{
        text: string;
        suggestedOwner: string | null;
        messageId: string | null;
      }>,
      blockers: [] as Array<{ text: string; messageId: string | null }>,
      poweredByAi: false,
      messageCount: 0,
      firstUnreadMessageId: null as string | null,
      since: sinceRaw,
    };

    if (unread.length === 0) {
      return empty;
    }

    const indexed = unread
      .map((message, index) => {
        const body =
          message.body?.trim() ||
          (message.attachment
            ? `[file: ${message.attachment.name || 'attachment'}]`
            : '');
        if (!body) return null;
        return {
          index: index + 1,
          id: message.id,
          senderId: message.senderId,
          body: body.slice(0, 400),
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    const firstUnreadMessageId = unread[0]?.id ?? null;
    const transcript = indexed
      .map(
        (row) =>
          `[${row.index}] id=${row.id} from=${row.senderId.slice(0, 8)}: ${row.body}`,
      )
      .join('\n')
      .slice(0, 8000);

    const idByIndex = new Map(indexed.map((row) => [row.index, row.id]));

    const parsePulseJson = (raw: string) => {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      try {
        const parsed = JSON.parse(jsonMatch[0]) as {
          headline?: unknown;
          decisions?: unknown;
          openLoops?: unknown;
          blockers?: unknown;
        };
        const mapDecision = (item: unknown) => {
          if (!item || typeof item !== 'object') return null;
          const row = item as { text?: unknown; ref?: unknown };
          const text = String(row.text ?? '').trim();
          if (!text) return null;
          const ref = Number(row.ref);
          return {
            text: text.slice(0, 240),
            messageId:
              Number.isFinite(ref) && idByIndex.has(ref)
                ? idByIndex.get(ref)!
                : null,
          };
        };
        const mapLoop = (item: unknown) => {
          if (!item || typeof item !== 'object') return null;
          const row = item as {
            text?: unknown;
            ref?: unknown;
            suggestedOwner?: unknown;
          };
          const text = String(row.text ?? '').trim();
          if (!text) return null;
          const ref = Number(row.ref);
          return {
            text: text.slice(0, 240),
            suggestedOwner: row.suggestedOwner
              ? String(row.suggestedOwner).trim().slice(0, 80)
              : null,
            messageId:
              Number.isFinite(ref) && idByIndex.has(ref)
                ? idByIndex.get(ref)!
                : null,
          };
        };
        const decisions = (
          Array.isArray(parsed.decisions) ? parsed.decisions : []
        )
          .map(mapDecision)
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .slice(0, 5);
        const openLoops = (
          Array.isArray(parsed.openLoops) ? parsed.openLoops : []
        )
          .map(mapLoop)
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .slice(0, 5);
        const blockers = (Array.isArray(parsed.blockers) ? parsed.blockers : [])
          .map(mapDecision)
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .slice(0, 5);
        if (
          decisions.length === 0 &&
          openLoops.length === 0 &&
          blockers.length === 0
        ) {
          return null;
        }
        return {
          headline: String(
            parsed.headline ??
              `Pulse · ${unread.length} unread in ${conversation.name || 'channel'}`,
          ).slice(0, 160),
          decisions,
          openLoops,
          blockers,
        };
      } catch {
        return null;
      }
    };

    if (indexed.length > 0) {
      const ai = await this.chatComplete({
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You are Channel Pulse for a team messenger. Analyze unread messages and return JSON ONLY: {"headline":"one short line","decisions":[{"text":"...","ref":1}],"openLoops":[{"text":"...","suggestedOwner":"name or null","ref":2}],"blockers":[{"text":"...","ref":3}]}. decisions = choices already made. openLoops = unanswered questions / waiting on someone. blockers = stuck / blocked / risk. Use ref = message index numbers from the transcript. Max 4 items per array. Be concrete. No markdown.',
          },
          {
            role: 'user',
            content: `Unread messages (${unread.length}):\n${transcript}`,
          },
        ],
      });
      if (ai?.content) {
        const structured = parsePulseJson(ai.content);
        if (structured) {
          return {
            ...structured,
            poweredByAi: true,
            messageCount: unread.length,
            firstUnreadMessageId,
            since: sinceRaw,
          };
        }
      }
    }

    const heuristic = this.heuristicChannelPulse(indexed);
    return {
      ...heuristic,
      poweredByAi: this.isDemoAi(),
      messageCount: unread.length,
      firstUnreadMessageId,
      since: sinceRaw,
    };
  }

  private heuristicChannelPulse(
    indexed: Array<{ index: number; id: string; senderId: string; body: string }>,
  ): {
    headline: string;
    decisions: Array<{ text: string; messageId: string | null }>;
    openLoops: Array<{
      text: string;
      suggestedOwner: string | null;
      messageId: string | null;
    }>;
    blockers: Array<{ text: string; messageId: string | null }>;
  } {
    const decisions: Array<{ text: string; messageId: string | null }> = [];
    const openLoops: Array<{
      text: string;
      suggestedOwner: string | null;
      messageId: string | null;
    }> = [];
    const blockers: Array<{ text: string; messageId: string | null }> = [];

    for (const row of indexed) {
      const lower = row.body.toLowerCase();
      if (
        /\b(blocked|blocker|stuck|waiting on|can't proceed|cannot proceed|dependency)\b/i.test(
          lower,
        )
      ) {
        if (blockers.length < 4) {
          blockers.push({ text: row.body.slice(0, 180), messageId: row.id });
        }
        continue;
      }
      if (
        row.body.includes('?') ||
        /\b(can you|could you|please|need|anyone|who can|wmydt|wdyt)\b/i.test(
          lower,
        )
      ) {
        if (openLoops.length < 4) {
          openLoops.push({
            text: row.body.slice(0, 180),
            suggestedOwner: null,
            messageId: row.id,
          });
        }
        continue;
      }
      if (
        /\b(decided|decision|approved|ship it|going with|we'll|we will|final|locked)\b/i.test(
          lower,
        )
      ) {
        if (decisions.length < 4) {
          decisions.push({ text: row.body.slice(0, 180), messageId: row.id });
        }
      }
    }

    if (
      decisions.length === 0 &&
      openLoops.length === 0 &&
      blockers.length === 0
    ) {
      for (const row of indexed.slice(-3)) {
        openLoops.push({
          text: row.body.slice(0, 180),
          suggestedOwner: null,
          messageId: row.id,
        });
      }
    }

    const parts: string[] = [];
    if (decisions.length) parts.push(`${decisions.length} decision${decisions.length === 1 ? '' : 's'}`);
    if (openLoops.length) parts.push(`${openLoops.length} open loop${openLoops.length === 1 ? '' : 's'}`);
    if (blockers.length) parts.push(`${blockers.length} blocker${blockers.length === 1 ? '' : 's'}`);

    return {
      headline:
        parts.length > 0
          ? `Pulse · ${parts.join(' · ')}`
          : `Pulse · ${indexed.length} recent messages`,
      decisions,
      openLoops,
      blockers,
    };
  }

  /**
   * Voice → Action: turn natural language into one Relay work object.
   * Always confirm in the UI before writing.
   */
  async parseActionIntent(rawText: string): Promise<{
    action: 'stuck' | 'task' | 'remind' | 'incident' | 'unknown';
    title: string;
    body: string;
    whenHint: string | null;
    severity: 'sev1' | 'sev2' | 'sev3' | 'sev4' | null;
    confidence: number;
    poweredByAi: boolean;
    summary: string;
  }> {
    const cleaned = String(rawText ?? '').trim().slice(0, 1000);
    if (cleaned.length < 3) {
      throw new BadRequestAppException(
        'Say or type what you want Relay to do (at least a few words)',
      );
    }

    const ai = await this.chatComplete({
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content:
            'You map spoken/typed intent to ONE Relay workspace action. Return JSON ONLY: {"action":"stuck"|"task"|"remind"|"incident"|"unknown","title":"short title","body":"optional detail","whenHint":"1h|30m|tomorrow|null","severity":"sev1|sev2|sev3|sev4|null","summary":"one line for the confirm UI"}. Rules: stuck = blocked / need help; task = todo / add to list; remind = remind me later; incident = outage / sev / war-room; unknown = unclear. Prefer concrete titles under 120 chars.',
        },
        { role: 'user', content: cleaned },
      ],
    });

    if (ai?.content) {
      const jsonMatch = ai.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
          const actionRaw = String(parsed.action ?? 'unknown').toLowerCase();
          const allowedActions = new Set([
            'stuck',
            'task',
            'remind',
            'incident',
            'unknown',
          ]);
          const action = (
            allowedActions.has(actionRaw) ? actionRaw : 'unknown'
          ) as 'stuck' | 'task' | 'remind' | 'incident' | 'unknown';
          const severityRaw = String(parsed.severity ?? '').toLowerCase();
          const allowedSev = new Set(['sev1', 'sev2', 'sev3', 'sev4']);
          const severity = (
            allowedSev.has(severityRaw) ? severityRaw : null
          ) as 'sev1' | 'sev2' | 'sev3' | 'sev4' | null;
          const title = String(parsed.title ?? cleaned).trim().slice(0, 160);
          const body = String(parsed.body ?? '').trim().slice(0, 500);
          const whenHint = parsed.whenHint
            ? String(parsed.whenHint).trim().slice(0, 40)
            : null;
          const summary = String(parsed.summary ?? title).trim().slice(0, 200);
          if (title) {
            return {
              action,
              title,
              body,
              whenHint: whenHint === 'null' ? null : whenHint,
              severity,
              confidence: action === 'unknown' ? 0.4 : 0.85,
              poweredByAi: true,
              summary,
            };
          }
        } catch {
          // heuristic below
        }
      }
    }

    return {
      ...this.heuristicActionIntent(cleaned),
      poweredByAi: this.isDemoAi(),
    };
  }

  private heuristicActionIntent(cleaned: string): {
    action: 'stuck' | 'task' | 'remind' | 'incident' | 'unknown';
    title: string;
    body: string;
    whenHint: string | null;
    severity: 'sev1' | 'sev2' | 'sev3' | 'sev4' | null;
    confidence: number;
    summary: string;
  } {
    const lower = cleaned.toLowerCase();
    const whenMatch = lower.match(
      /\b(?:in\s+)?(\d+\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)|tomorrow|tonight|later)\b/i,
    );
    let whenHint: string | null = null;
    if (whenMatch) {
      const raw = whenMatch[1].replace(/\s+/g, '');
      if (/tomorrow/i.test(raw)) whenHint = 'tomorrow';
      else if (/tonight|later/i.test(raw)) whenHint = '1h';
      else if (/m|min/i.test(raw)) {
        const n = parseInt(raw, 10) || 30;
        whenHint = `${n}m`;
      } else {
        const n = parseInt(raw, 10) || 1;
        whenHint = `${n}h`;
      }
    }

    const sevMatch = lower.match(/\bsev\s*([1-4])\b|\bseverity\s*([1-4])\b/);
    const severity = sevMatch
      ? (`sev${sevMatch[1] || sevMatch[2]}` as 'sev1' | 'sev2' | 'sev3' | 'sev4')
      : null;

    if (
      /\b(incident|outage|down|sev\s*[1-4]|war.?room|page oncall)\b/i.test(lower)
    ) {
      const title = cleaned
        .replace(/^\/act\s+/i, '')
        .replace(/\b(open\s+)?(sev\s*[1-4]|incident)\b/gi, '')
        .trim()
        .slice(0, 160) || 'Ongoing incident';
      return {
        action: 'incident',
        title,
        body: cleaned,
        whenHint: null,
        severity: severity ?? 'sev2',
        confidence: 0.7,
        summary: `Open ${severity ?? 'sev2'} incident: ${title}`,
      };
    }

    if (
      /\b(remind|reminder|ping me|nudge me|don't forget|dont forget)\b/i.test(
        lower,
      ) ||
      whenHint
    ) {
      const title = cleaned
        .replace(/^\/act\s+/i, '')
        .replace(
          /\b(remind( me)?( to)?|in\s+\d+\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)|tomorrow|tonight|later)\b/gi,
          '',
        )
        .trim()
        .slice(0, 160) || cleaned.slice(0, 160);
      return {
        action: 'remind',
        title,
        body: cleaned,
        whenHint: whenHint ?? '1h',
        severity: null,
        confidence: 0.72,
        summary: `Remind in ${whenHint ?? '1h'}: ${title}`,
      };
    }

    if (
      /\b(stuck|blocked|blocker|need help|can't proceed|cannot proceed|waiting on)\b/i.test(
        lower,
      )
    ) {
      const title = cleaned.replace(/^\/act\s+/i, '').trim().slice(0, 160);
      return {
        action: 'stuck',
        title,
        body: title,
        whenHint: null,
        severity: null,
        confidence: 0.75,
        summary: `Raise Stuck: ${title}`,
      };
    }

    if (
      /\b(task|todo|to-do|add to list|create task|follow up|action item)\b/i.test(
        lower,
      )
    ) {
      const title = cleaned
        .replace(/^\/act\s+/i, '')
        .replace(
          /\b(add( a)?|create( a)?|new)?\s*(task|todo|to-do|action item|list item)\b/gi,
          '',
        )
        .replace(/\b(to (the )?list|please)\b/gi, '')
        .trim()
        .slice(0, 160) || cleaned.slice(0, 160);
      return {
        action: 'task',
        title,
        body: cleaned,
        whenHint: null,
        severity: null,
        confidence: 0.7,
        summary: `Create task: ${title}`,
      };
    }

    return {
      action: 'unknown',
      title: cleaned.slice(0, 160),
      body: cleaned,
      whenHint: null,
      severity: null,
      confidence: 0.35,
      summary: `Not sure — pick an action for: ${cleaned.slice(0, 80)}`,
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
    let replies: string[];
    if (lower.includes('?')) {
      replies = ['Yes, sounds good', 'Let me check', 'Not sure yet'];
    } else if (lower.includes('thanks') || lower.includes('thank you')) {
      replies = ["You're welcome!", 'Anytime', 'Happy to help'];
    } else if (lower.includes('meet') || lower.includes('call')) {
      replies = ['Works for me', 'What time?', 'Can we do async?'];
    } else {
      replies = ['On it', 'Got it', 'Will follow up'];
    }
    return {
      replies,
      poweredByAi: this.isDemoAi(),
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
      translatedText: this.isDemoAi()
        ? `(${lang}) ${text}`
        : `[${lang}] ${text}`,
      detectedLanguage: null,
      poweredByAi: this.isDemoAi(),
    };
  }

  /**
   * Ask Relay — hybrid RAG: FTS retrieve → LLM answer with citations.
   * Mention-style questions use the mentions index (not keyword search).
   * Without a running LLM, returns a ranked excerpt digest.
   * DEMO_AI / RELAY_DEMO_MODE always returns a polished grounded answer.
   */
  async askRelay(
    actorId: string,
    question: string,
    conversationId?: string | null,
  ): Promise<{
    answer: string;
    poweredByAi: boolean;
    demoMode?: boolean;
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
      if (this.isDemoAi()) {
        return {
          answer: this.demoAskFromCitations(cleaned, citations, true),
          poweredByAi: true,
          demoMode: true,
          citations: citations.slice(0, 5),
        };
      }
      return {
        answer: `Recent messages that @mentioned you:\n${digest}`,
        poweredByAi: false,
        citations: citations.slice(0, 5),
      };
    }

    if (this.isDemoAi()) {
      return {
        answer: this.demoAskFromCitations(cleaned, citations, false),
        poweredByAi: true,
        demoMode: true,
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
      poweredByAi: Boolean(ai?.content) || anyAi || this.isDemoAi(),
      overview:
        ai?.content ||
        (this.isDemoAi()
          ? `Morning digest (demo AI): ${sections.length} conversation${
              sections.length === 1 ? '' : 's'
            } need attention — start with the highest unread counts below.`
          : `You have unread activity in ${sections.length} conversation${
              sections.length === 1 ? '' : 's'
            }. Open each section below to jump in.`),
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
