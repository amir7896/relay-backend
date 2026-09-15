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
    const id = randomUUID();

    // Avatars: relay/profilePictures/{uuid}
    // Voice:   relay/{userName}/voiceNotes/{uuid}
    // Images:  relay/{userName}/images/{uuid}
    // Docs:    relay/{userName}/files/{uuid}.ext  (raw public IDs should include extension)
    let publicId: string;
    if (file.purpose === 'avatar') {
      if (!isImage) {
        throw new Error('Profile pictures must be image files');
      }
      publicId = [this.rootFolder, 'profilePictures', id].filter(Boolean).join('/');
    } else if (file.purpose === 'emoji') {
      if (!isImage) {
        throw new Error('Custom emoji must be image files');
      }
      publicId = [this.rootFolder, 'customEmojis', id].filter(Boolean).join('/');
    } else {
      const mediaFolder = isAudio ? 'voiceNotes' : isImage ? 'images' : 'files';
      publicId =
        isImage || isAudio
          ? [this.rootFolder, user, mediaFolder, id].filter(Boolean).join('/')
          : [this.rootFolder, user, mediaFolder, extension ? `${id}.${extension}` : id]
              .filter(Boolean)
              .join('/');
    }

    // Cloudinary: audio → video resource; documents → raw.
    const resourceType = isAudio ? 'video' : isImage ? 'image' : 'raw';

    const result = await new Promise<{
      secure_url: string;
      public_id: string;
    }>((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            public_id: publicId,
            resource_type: resourceType,
            type: 'upload',
            access_mode: 'public',
            folder: undefined,
            // Only set format for image/video; raw already has extension in public_id
            format: isImage || isAudio ? extension || undefined : undefined,
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

  resolveDownloadUrl(
    url: string,
    options?: { filename?: string; expiresInSeconds?: number },
  ): string | null {
    const parsed = this.parseCloudinaryUrl(url);
    if (!parsed) {
      return null;
    }

    const expiresAt =
      Math.floor(Date.now() / 1000) +
      Math.max(60, options?.expiresInSeconds ?? 60 * 60);

    // Signed / private download URLs bypass Cloudinary "restricted media" 401s
    // (e.g. PDF/ZIP delivery disabled in Security settings).
    return cloudinary.utils.private_download_url(
      parsed.publicId,
      parsed.format || '',
      {
        resource_type: parsed.resourceType,
        type: 'upload',
        expires_at: expiresAt,
        attachment: true,
      },
    );
  }

  async downloadBuffer(url: string): Promise<Buffer> {
    const parsed = this.parseCloudinaryUrl(url);
    const candidates: string[] = [];

    if (parsed) {
      const publicIds =
        parsed.resourceType === 'raw'
          ? Array.from(
              new Set([
                parsed.publicId,
                parsed.publicId.replace(/\.[^/.]+$/, ''),
                parsed.format
                  ? `${parsed.publicId.replace(/\.[^/.]+$/, '')}.${parsed.format}`
                  : '',
              ].filter(Boolean)),
            )
          : [parsed.publicId];

      const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
      for (const publicId of publicIds) {
        candidates.push(
          cloudinary.utils.private_download_url(publicId, parsed.format || '', {
            resource_type: parsed.resourceType,
            type: 'upload',
            expires_at: expiresAt,
            attachment: true,
          }),
        );
      }
    }

    candidates.push(url);

    let lastError: Error | null = null;
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate);
        if (response.ok) {
          return Buffer.from(await response.arrayBuffer());
        }
        lastError = new Error(`Cloudinary download failed (${response.status})`);
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError ?? new Error('Cloudinary download failed');
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
    format: string;
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
      const rest = decodeURIComponent(match[2]);
      const formatMatch = rest.match(/\.([^./]+)$/);
      const format = formatMatch?.[1] ?? '';
      // Raw public IDs usually include the extension; image/video usually do not.
      const publicId =
        resourceType === 'raw' ? rest : rest.replace(/\.[^/.]+$/, '');
      if (!publicId) {
        return null;
      }
      return { publicId, resourceType, format };
    } catch {
      return null;
    }
  }
}
