import { BadRequestException, Injectable } from '@nestjs/common';
import { parse } from 'csv-parse';
import { Readable } from 'stream';

const EXPECTED_HEADERS = [
  'name',
  'departmentCode',
  'latitude',
  'longitude',
  'cameraType',
  'brand',
  'model',
  'addressText',
  'installedAt',
];

export interface ParsedCsvRow {
  rowNumber: number;
  raw: Record<string, string>;
}

@Injectable()
export class CsvParserService {
  // Fast, synchronous check run before any job is created — a structurally
  // broken file (wrong headers, empty) never gets a bulk_upload_job row.
  validateStructure(fileBuffer: Buffer): void {
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException('Uploaded file is empty');
    }

    const firstLine = fileBuffer.toString('utf-8').split('\n')[0]?.trim();
    if (!firstLine) {
      throw new BadRequestException('Uploaded file has no header row');
    }

    const headers = firstLine.split(',').map((h) => h.trim());
    const missing = EXPECTED_HEADERS.filter((h) => !headers.includes(h));
    if (missing.length > 0) {
      throw new BadRequestException(
        `CSV is missing required column(s): ${missing.join(', ')}`,
      );
    }
  }

  // Streams rows one at a time rather than parsing the whole file into an
  // array up front — matters at a 10,000-row scale so memory use stays
  // proportional to one row, not the whole file.
  async *parseRows(fileBuffer: Buffer): AsyncGenerator<ParsedCsvRow> {
    const parser = Readable.from(fileBuffer).pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }),
    );

    let rowNumber = 1; // header is row 1
    for await (const record of parser) {
      rowNumber += 1;
      yield { rowNumber, raw: record as Record<string, string> };
    }
  }
}
