import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { StorageProvider } from './storage-provider.interface';

// Cloudinary's upload_stream callback rejects with a plain object (typically
// { message, http_code, name }), not an Error instance — String(error) on
// that gives "[object Object]" and throws away the real reason. Pull out
// .message when present so callers (and BadGatewayException) see the actual
// cause instead of an opaque string.
function describeCloudinaryError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    const withCode = error as { message: string; http_code?: number };
    return withCode.http_code ? `${withCode.message} (http_code ${withCode.http_code})` : withCode.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

@Injectable()
export class CloudinaryStorageProvider implements StorageProvider {
  constructor(private readonly config: ConfigService) {
    cloudinary.config({
      cloud_name: this.config.get<string>('cloudinary.cloudName'),
      api_key: this.config.get<string>('cloudinary.apiKey'),
      api_secret: this.config.get<string>('cloudinary.apiSecret'),
    });
  }

  save(fileBuffer: Buffer, key: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { public_id: key, folder: 'sentinel-camera-photos', overwrite: true },
        (error, result) => {
          if (error || !result) {
            reject(error instanceof Error ? error : new Error(describeCloudinaryError(error)));
            return;
          }
          resolve(result.secure_url);
        },
      );
      uploadStream.end(fileBuffer);
    });
  }
}
