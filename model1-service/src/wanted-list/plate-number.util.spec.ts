import { normalizePlateNumber } from './plate-number.util';

describe('normalizePlateNumber', () => {
  it('uppercases the plate', () => {
    expect(normalizePlateNumber('gj01ab1234')).toBe('GJ01AB1234');
  });

  it('strips internal spaces', () => {
    expect(normalizePlateNumber('GJ 01 AB 1234')).toBe('GJ01AB1234');
  });

  it('strips hyphens', () => {
    expect(normalizePlateNumber('GJ-01-AB-1234')).toBe('GJ01AB1234');
  });

  it('trims leading/trailing whitespace', () => {
    expect(normalizePlateNumber('  GJ01AB1234  ')).toBe('GJ01AB1234');
  });

  it('produces the same result for all equivalent formats', () => {
    const variants = ['GJ01AB1234', 'gj 01 ab 1234', 'GJ-01-AB-1234', ' gj01ab1234 '];
    const normalized = variants.map(normalizePlateNumber);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('GJ01AB1234');
  });
});
