import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import {
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import type { ObjectStorage, UploadInput, UploadResult } from './storage.types';

export type S3StorageOptions = {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  publicUrl?: string;
  forcePathStyle?: boolean;
  prefix?: string;
};

export class S3Storage implements ObjectStorage {
  readonly driver = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl?: string;
  private readonly endpoint?: string;
  private readonly forcePathStyle: boolean;
  private readonly prefix: string;
  private readonly region: string;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;
    this.publicUrl = options.publicUrl?.replace(/\/$/, '');
    this.endpoint = options.endpoint?.replace(/\/$/, '');
    this.forcePathStyle = Boolean(options.forcePathStyle);
    this.prefix = (options.prefix || 'relay').replace(/^\/|\/$/g, '');
    this.region = options.region;

    const config: S3ClientConfig = {
      region: options.region,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    };
    if (this.endpoint) {
      config.endpoint = this.endpoint;
      config.forcePathStyle = this.forcePathStyle;
    }
    this.client = new S3Client(config);
  }

  async upload(file: UploadInput): Promise<UploadResult> {
    const extension = extname(file.originalName).toLowerCase() || '.bin';
    const key = `${this.prefix}/${randomUUID()}${extension}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimeType,
        ContentLength: file.size,
      }),
    );

    return {
      url: this.buildPublicUrl(key),
      key,
      provider: this.driver,
      mime: file.mimeType,
      name: file.originalName,
      size: file.size,
    };
  }

  private buildPublicUrl(key: string): string {
    if (this.publicUrl) {
      return `${this.publicUrl}/${key}`;
    }
    if (this.endpoint) {
      if (this.forcePathStyle) {
        return `${this.endpoint}/${this.bucket}/${key}`;
      }
      const host = this.endpoint.replace(/^https?:\/\//, '');
      const protocol = this.endpoint.startsWith('http://') ? 'http' : 'https';
      return `${protocol}://${this.bucket}.${host}/${key}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }
}
