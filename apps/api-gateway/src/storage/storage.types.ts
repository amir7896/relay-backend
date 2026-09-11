export type StorageDriver = 'local' | 's3' | 'cloudinary';

export type UploadInput = {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
  /** Used to build Cloudinary path relay/{userName}/voiceNotes/ */
  userName?: string;
};

export type UploadResult = {
  url: string;
  key: string;
  provider: StorageDriver;
  mime: string;
  name: string;
  size: number;
};

export interface ObjectStorage {
  readonly driver: StorageDriver;
  upload(file: UploadInput): Promise<UploadResult>;
  /** Best-effort delete of a previously uploaded object by its public URL */
  deleteByUrl?(url: string): Promise<void>;
}

/** Safe Cloudinary / S3 path segment from email or display name */
export function storageUserName(raw: string | undefined | null): string {
  const base = (raw ?? 'user')
    .trim()
    .toLowerCase()
    .split('@')[0]
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'user';
}
