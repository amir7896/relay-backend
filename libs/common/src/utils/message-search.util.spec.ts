import {
  buildTsQuery,
  parseMessageSearchQuery,
} from './message-search.util';

describe('parseMessageSearchQuery', () => {
  it('parses Slack-style operators and free text', () => {
    const parsed = parseMessageSearchQuery(
      'budget from:jane in:#general has:file after:7d plan',
    );
    expect(parsed.text).toBe('budget plan');
    expect(parsed.fromTokens).toEqual(['jane']);
    expect(parsed.inChannels).toEqual(['general']);
    expect(parsed.has).toEqual(['file']);
    expect(parsed.after).toBeInstanceOf(Date);
  });

  it('supports quoted from tokens', () => {
    const parsed = parseMessageSearchQuery('from:"Jane Doe" hello');
    expect(parsed.fromTokens).toEqual(['jane doe']);
    expect(parsed.text).toBe('hello');
  });
});

describe('buildTsQuery', () => {
  it('builds prefix tsquery terms', () => {
    expect(buildTsQuery('Ship it')).toBe('ship:* & it:*');
  });

  it('returns null for short noise', () => {
    expect(buildTsQuery('a')).toBeNull();
  });
});
