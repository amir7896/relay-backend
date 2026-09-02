import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { v2 as cloudinary } from 'cloudinary';
import type { ObjectStorage, UploadInput, UploadResult } from './storage.types';

export type CloudinaryStorageOptions = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  folder?: string;
};

export class CloudinaryStorage implements ObjectStorage {
  readonly driver = 'cloudinary' as const;
  private readonly folder: string;

  constructor(options: CloudinaryStorageOptions) {
    this.folder = (options.folder || 'relay').replace(/^\/|\/$/g, '');
    cloudinary.config({
      cloud_name: options.cloudName,
      api_key: options.apiKey,
      api_secret: options.apiSecret,
      secure: true,
    });
  }

  async upload(file: UploadInput): Promise<UploadResult> {
    const extension = extname(file.originalName).toLowerCase().replace('.', '');
    const publicId = `${this.folder}/${randomUUID()}`;
    const resourceType = file.mimeType.startsWith('audio/')
      ? 'video'
      : file.mimeType.startsWith('image/')
        ? 'image'
        : 'auto';

    const result = await new Promise<{
      secure_url: string;
      public_id: string;
    }>((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            public_id: publicId,
            resource_type: resourceType,
            folder: undefined,
            format: extension || undefined,
          },
          (error, uploaded) => {
            if (error || !uploaded?.secure_url) {
              reject(error ?? new Error('Cloudinary upload failed'));
              return;
            }
            resolve({
              secure_url: uploaded.secure_url,
              public_id: uploaded.public_id,
            });
          },
        )
        .end(file.buffer);
    });

    return {
      url: result.secure_url,
      key: result.public_id,
      provider: this.driver,
      mime: file.mimeType,
      name: file.originalName,
      size: file.size,
    };
  }
}
