export type StorageDriver = 'local' | 's3' | 'cloudinary';

export type UploadInput = {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
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
}
