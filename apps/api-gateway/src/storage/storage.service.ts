import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CloudinaryStorage } from './cloudinary.storage';
import { LocalStorage } from './local.storage';
import { S3Storage } from './s3.storage';
import type {
  ObjectStorage,
  StorageDriver,
  UploadInput,
  UploadResult,
} from './storage.types';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly adapter: ObjectStorage;

  constructor(private readonly config: ConfigService) {
    const driver = this.config.get<StorageDriver>('STORAGE_DRIVER', 'local');
    this.adapter = this.createAdapter(driver);
    this.logger.log(`File storage driver: ${this.adapter.driver}`);
  }

  get driver(): StorageDriver {
    return this.adapter.driver;
  }

  getLocalRoot(): string | null {
    if (this.adapter instanceof LocalStorage) {
      return this.adapter.getRoot();
    }
    return null;
  }

  upload(file: UploadInput): Promise<UploadResult> {
    return this.adapter.upload(file);
  }

  async deleteByUrl(url: string): Promise<void> {
    if (!url || !this.adapter.deleteByUrl) {
      return;
    }
    try {
      await this.adapter.deleteByUrl(url);
    } catch (error) {
      this.logger.warn(
        `Failed to delete storage object for ${url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  resolveDownloadUrl(
    url: string,
    options?: { filename?: string; expiresInSeconds?: number },
  ): string {
    if (!url) {
      return url;
    }
    return (
      this.adapter.resolveDownloadUrl?.(url, options) ?? url
    );
  }

  async downloadBuffer(url: string): Promise<Buffer> {
    if (this.adapter.downloadBuffer) {
      return this.adapter.downloadBuffer(url);
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed (${response.status})`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private createAdapter(driver: StorageDriver): ObjectStorage {
    if (driver === 's3') {
      return new S3Storage({
        region: this.config.getOrThrow<string>('STORAGE_S3_REGION'),
        bucket: this.config.getOrThrow<string>('STORAGE_S3_BUCKET'),
        accessKeyId: this.config.getOrThrow<string>('STORAGE_S3_ACCESS_KEY_ID'),
        secretAccessKey: this.config.getOrThrow<string>(
          'STORAGE_S3_SECRET_ACCESS_KEY',
        ),
        endpoint: this.config.get<string>('STORAGE_S3_ENDPOINT') || undefined,
        publicUrl: this.config.get<string>('STORAGE_S3_PUBLIC_URL') || undefined,
        forcePathStyle: this.config.get<boolean>(
          'STORAGE_S3_FORCE_PATH_STYLE',
          false,
        ),
        prefix: this.config.get<string>('STORAGE_S3_PREFIX', 'relay'),
      });
    }

    if (driver === 'cloudinary') {
      return new CloudinaryStorage({
        cloudName: this.config.getOrThrow<string>(
          'STORAGE_CLOUDINARY_CLOUD_NAME',
        ),
        apiKey: this.config.getOrThrow<string>('STORAGE_CLOUDINARY_API_KEY'),
        apiSecret: this.config.getOrThrow<string>(
          'STORAGE_CLOUDINARY_API_SECRET',
        ),
        folder: this.config.get<string>('STORAGE_CLOUDINARY_FOLDER', 'relay'),
      });
    }

    return new LocalStorage(
      this.config.get<string>('STORAGE_LOCAL_DIR', 'uploads'),
    );
  }
}
