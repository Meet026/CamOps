import { BadRequestException } from '@nestjs/common';
import { CsvParserService } from './csv-parser.service';

describe('CsvParserService', () => {
  let service: CsvParserService;

  beforeEach(() => {
    service = new CsvParserService();
  });

  const validHeader =
    'name,departmentCode,latitude,longitude,cameraType,brand,model,addressText,installedAt\n';

  describe('validateStructure', () => {
    it('does not throw for a valid header row', () => {
      const buffer = Buffer.from(validHeader + 'Camera A,HOME,23.0,72.0,ip,,,,\n');
      expect(() => service.validateStructure(buffer)).not.toThrow();
    });

    it('throws BadRequestException for an empty file', () => {
      const buffer = Buffer.from('');
      expect(() => service.validateStructure(buffer)).toThrow(BadRequestException);
    });

    it('throws BadRequestException when a required header column is missing', () => {
      const buffer = Buffer.from('name,departmentCode,latitude,longitude,cameraType\n');
      expect(() => service.validateStructure(buffer)).toThrow(BadRequestException);
    });

    it('throws BadRequestException when headers are present but misspelled', () => {
      const buffer = Buffer.from(
        'name,deptCode,latitude,longitude,cameraType,brand,model,addressText,installedAt\n',
      );
      expect(() => service.validateStructure(buffer)).toThrow(BadRequestException);
    });
  });

  describe('parseRows', () => {
    it('yields each data row with a 1-indexed rowNumber counting the header as row 1', async () => {
      const buffer = Buffer.from(
        validHeader + 'Camera A,HOME,23.0,72.0,ip,,,,\nCamera B,RTO,22.0,71.0,analog,,,,\n',
      );

      const rows = [];
      for await (const row of service.parseRows(buffer)) {
        rows.push(row);
      }

      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({
        rowNumber: 2,
        raw: {
          name: 'Camera A',
          departmentCode: 'HOME',
          latitude: '23.0',
          longitude: '72.0',
          cameraType: 'ip',
          brand: '',
          model: '',
          addressText: '',
          installedAt: '',
        },
      });
      expect(rows[1].rowNumber).toBe(3);
      expect(rows[1].raw.name).toBe('Camera B');
    });

    it('counts total data rows correctly for a larger file', async () => {
      const dataRows = Array.from(
        { length: 20 },
        (_, i) => `Camera ${i},HOME,23.0,72.0,ip,,,,`,
      ).join('\n');
      const buffer = Buffer.from(validHeader + dataRows + '\n');

      const rows = [];
      for await (const row of service.parseRows(buffer)) {
        rows.push(row);
      }

      expect(rows).toHaveLength(20);
      expect(rows[19].rowNumber).toBe(21);
    });
  });
});
