// Mirrors the backend's plate handling (vehicle-ingest/src/plate_reader.py
// and SightingStore.find_by_plate) so the UI's hints agree with what the
// server will actually match.

const INDIAN_STATE_CODES = new Set([
  'AN', 'AP', 'AR', 'AS', 'BR', 'CG', 'CH', 'DD', 'DL', 'DN', 'GA', 'GJ',
  'HP', 'HR', 'JH', 'JK', 'KA', 'KL', 'LA', 'LD', 'MH', 'ML', 'MN', 'MP',
  'MZ', 'NL', 'OD', 'OR', 'PB', 'PY', 'RJ', 'SK', 'TN', 'TR', 'TS', 'UK',
  'UP', 'WB',
])
const STATE_PLATE = /^([A-Z]{2})[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/
const BH_PLATE = /^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/

export function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function looksLikeIndianPlate(normalized: string): boolean {
  if (BH_PLATE.test(normalized)) return true
  const match = STATE_PLATE.exec(normalized)
  return match !== null && INDIAN_STATE_CODES.has(match[1])
}
