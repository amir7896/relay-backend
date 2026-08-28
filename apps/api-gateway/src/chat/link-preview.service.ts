import { Injectable } from '@nestjs/common';

export type LinkPreviewResult = {
  url: string;
  title: string;
  description: string;
  image: string | null;
};

@Injectable()
export class LinkPreviewService {
  async fetch(url: string): Promise<LinkPreviewResult> {
    const normalized = url.trim();
    const response = await fetch(normalized, {
      headers: { 'User-Agent': 'RelayBot/1.0' },
      redirect: 'follow',
    });
    const html = await response.text();
    const title = this.readMeta(html, 'og:title') ?? this.readTitle(html) ?? normalized;
    const description =
      this.readMeta(html, 'og:description') ??
      this.readMeta(html, 'description') ??
      '';
    const image = this.readMeta(html, 'og:image');
    return {
      url: normalized,
      title: title.slice(0, 200),
      description: description.slice(0, 400),
      image: image ? this.resolveUrl(normalized, image) : null,
    };
  }

  private readMeta(html: string, key: string): string | null {
    const patterns = [
      new RegExp(
        `<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`,
        'i',
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["']`,
        'i',
      ),
      new RegExp(
        `<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["']`,
        'i',
      ),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        return this.decode(match[1]);
      }
    }
    return null;
  }

  private readTitle(html: string): string | null {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match?.[1] ? this.decode(match[1]) : null;
  }

  private decode(value: string): string {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  private resolveUrl(base: string, path: string): string {
    try {
      return new URL(path, base).toString();
    } catch {
      return path;
    }
  }
}
