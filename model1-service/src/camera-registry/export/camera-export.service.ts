import { Injectable } from '@nestjs/common';
import { stringify } from 'csv-stringify/sync';
import { CameraRecord } from '../camera-registry.service';

const EXPORT_COLUMNS: Array<keyof CameraRecord> = [
  'cameraId',
  'departmentId',
  'name',
  'addressText',
  'cameraType',
  'brand',
  'model',
  'onvifStatus',
  'onvifSource',
  'integrationScore',
  'dataConfidence',
  'currentStatus',
  'installedAt',
  'isActive',
  'latitude',
  'longitude',
  'createdAt',
  'updatedAt',
];

@Injectable()
export class CameraExportService {
  generateCsv(cameras: CameraRecord[]): string {
    const rows = cameras.map((camera) =>
      EXPORT_COLUMNS.map((column) => {
        const value = camera[column];
        if (value === null || value === undefined) return '';
        if (value instanceof Date) return value.toISOString();
        return String(value);
      }),
    );

    return stringify([EXPORT_COLUMNS, ...rows]);
  }
}
