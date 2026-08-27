import { Module } from '@nestjs/common';
import { CameraRegistryController } from './camera-registry.controller';
import { CameraRegistryService } from './camera-registry.service';
import { BulkUploadService } from './bulk-upload/bulk-upload.service';
import { CsvParserService } from './bulk-upload/csv-parser.service';
import { DepartmentLookupService } from './bulk-upload/department-lookup.service';
import { CameraExportService } from './export/camera-export.service';
import { AuditContextModule } from '../common/context/audit-context.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [AuditContextModule, StorageModule],
  controllers: [CameraRegistryController],
  providers: [
    CameraRegistryService,
    BulkUploadService,
    CsvParserService,
    DepartmentLookupService,
    CameraExportService,
  ],
  exports: [CameraRegistryService],
})
export class CameraRegistryModule {}
