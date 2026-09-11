import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ObjectStorage, UploadInput, UploadResult } from './storage.types';

export class LocalStorage implements ObjectStorage {
  readonly driver = 'local' as const;
  private readonly root: string;

  constructor(rootDir?: string) {
    this.root = resolve(process.cwd(), rootDir || 'uploads');
    if (!existsSync(this.root)) {
      mkdirSync(this.root, { recursive: true });
    }
  }

  async upload(file: UploadInput): Promise<UploadResult> {
    const extension = extname(file.originalName).toLowerCase() || '.bin';
    const key = `${randomUUID()}${extension}`;
    writeFileSync(join(this.root, key), file.buffer);
    return {
      url: `/uploads/${key}`,
      key,
      provider: this.driver,
      mime: file.mimeType,
      name: file.originalName,
      size: file.size,
    };
  }

  getRoot(): string {
    return this.root;
  }

  async deleteByUrl(url: string): Promise<void> {
    if (!url.startsWith('/uploads/')) {
      return;
    }
    const name = url.replace(/^\/uploads\//, '').split(/[/?#]/)[0];
    if (!name || name.includes('..')) {
      return;
    }
    const { unlink } = await import('node:fs/promises');
    try {
      await unlink(join(this.root, name));
    } catch {
      // File may already be gone
    }
  }
}
