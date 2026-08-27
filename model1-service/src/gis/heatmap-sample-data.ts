export interface HeatmapPoint {
  latitude: number;
  longitude: number;
  weight: number;
}

// Static, hand-picked sample data standing in for a real incident-tracking
// system that doesn't exist in this project (same deliberate-scope-
// boundary pattern as the FR-3 design's "PRD Corrections" section).
// Points are placed at real Gujarat coordinates so the overlay renders
// sensibly if actually plotted, but weight values are illustrative only —
// not derived from any real incident record.
export const HEATMAP_SAMPLE_POINTS: HeatmapPoint[] = [
  { latitude: 23.0225, longitude: 72.5714, weight: 8 }, // Ahmedabad
  { latitude: 22.3072, longitude: 73.1812, weight: 5 }, // Vadodara
  { latitude: 21.1702, longitude: 72.8311, weight: 6 }, // Surat
  { latitude: 22.4707, longitude: 70.0577, weight: 3 }, // Rajkot
  { latitude: 23.2156, longitude: 72.6369, weight: 4 }, // Gandhinagar
  { latitude: 21.6417, longitude: 69.6293, weight: 2 }, // Porbandar
];
