import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { v2 as cloudinary } from 'cloudinary';
import type { ObjectStorage, UploadInput, UploadResult } from './storage.types';
import { storageUserName } from './storage.types';

export type CloudinaryStorageOptions = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  /** Optional root override. Default voice path is relay/{userName}/voiceNotes */
  folder?: string;
};

export class CloudinaryStorage implements ObjectStorage {
  readonly driver = 'cloudinary' as const;
  private readonly rootFolder: string;

  constructor(options: CloudinaryStorageOptions) {
    this.rootFolder = (options.folder || 'relay').replace(/^\/|\/$/g, '');
    cloudinary.config({
      cloud_name: options.cloudName,
      api_key: options.apiKey,
      api_secret: options.apiSecret,
      secure: true,
    });
  }

  async upload(file: UploadInput): Promise<UploadResult> {
    const extension = extname(file.originalName).toLowerCase().replace('.', '');
    const isAudio =
      file.mimeType.startsWith('audio/') || file.mimeType === 'video/webm';
    const isImage = file.mimeType.startsWith('image/');
    const user = storageUserName(file.userName);

    // Voice: relay/{userName}/voiceNotes/{uuid}
    // Images: relay/{userName}/images/{uuid}
    // Other:  relay/{userName}/files/{uuid}
    const mediaFolder = isAudio ? 'voiceNotes' : isImage ? 'images' : 'files';
    const publicId = [this.rootFolder, user, mediaFolder, randomUUID()]
      .filter(Boolean)
      .join('/');

    // Cloudinary stores audio under the "video" resource type.
    const resourceType = isAudio ? 'video' : isImage ? 'image' : 'auto';

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

  async deleteByUrl(url: string): Promise<void> {
    const parsed = this.parseCloudinaryUrl(url);
    if (!parsed) {
      return;
    }
    await cloudinary.uploader.destroy(parsed.publicId, {
      resource_type: parsed.resourceType,
      invalidate: true,
    });
  }

  private parseCloudinaryUrl(url: string): {
    publicId: string;
    resourceType: 'image' | 'video' | 'raw';
  } | null {
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.includes('cloudinary.com')) {
        return null;
      }
      // /<cloud>/<resource_type>/upload/v123/folder/name.ext
      // /<cloud>/<resource_type>/upload/folder/name.ext
      const match = parsed.pathname.match(
        /\/(?:[^/]+)\/(image|video|raw)\/upload\/(?:v\d+\/)?(.+)$/,
      );
      if (!match) {
        return null;
      }
      const resourceType = match[1] as 'image' | 'video' | 'raw';
      const publicId = decodeURIComponent(match[2]).replace(/\.[^/.]+$/, '');
      if (!publicId) {
        return null;
      }
      return { publicId, resourceType };
    } catch {
      return null;
    }
  }
}
