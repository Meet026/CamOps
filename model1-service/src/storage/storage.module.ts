import { Module } from '@nestjs/common';
import { CloudinaryStorageProvider } from './cloudinary-storage.provider';
import { STORAGE_PROVIDER } from './storage-provider.token';

@Module({
  providers: [{ provide: STORAGE_PROVIDER, useClass: CloudinaryStorageProvider }],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
