/**
 * DEMO / FUTURE-SCOPE SIMULATION — not the production search path.
 *
 * This module powers the "Investigate" mode on the Vehicle Search page: a
 * walkthrough of the *proposed* plate-first investigation flow that this
 * project has not built for real yet. It exists so the approach can be
 * demonstrated end to end before the underlying capability exists.
 *
 * What is REAL here:
 *   - Every camera coordinate below is a genuine registered camera from
 *     this project's own `camera` table (Ahmedabad cluster, verified
 *     against the live database).
 *   - The corridor walk uses real haversine distance and the real
 *     3-4 km search-radius rule the proposal describes, so the hops and
 *     their distances are geographically honest.
 *
 * What is SIMULATED here:
 *   - The plate match itself. There is no ANPR model in this project.
 *   - Which vehicle is "found" at each hop, and the confidence numbers.
 *   - The processing delays, which pace the UI to mirror how long the
 *     real pipeline would plausibly take.
 *
 * Anything rendered from this module must be labelled as a simulation in
 * the UI. See INVESTIGATION_DISCLAIMER below — it is exported so the
 * banner text and this note can never drift apart.
 */

import type { VehicleRouteResponse } from '@/types/vehicleApi'

export const INVESTIGATION_DISCLAIMER =
  'Simulated future-scope workflow. Camera locations and distances are real; the plate match, vehicle matches and timings are illustrative.'

export interface DemoCamera {
  name: string
  lat: number
  lng: number
}

/**
 * Real registered cameras (Ahmedabad cluster) pulled from this project's
 * live `camera` table. Ordered south -> north; they form a genuine
 * corridor with realistic 1-6 km spacing.
 */
export const DEMO_CAMERAS: DemoCamera[] = [
  { name: 'Paldi Circle', lat: 23.01305, lng: 72.56252 },
  { name: 'CN Vidhyalaya', lat: 23.02056, lng: 72.55167 },
  { name: 'Janpath T CSITMS-10_PTZ2', lat: 23.024, lng: 72.571 },
  { name: 'Prem Darwaja Cam', lat: 23.0242, lng: 72.5873 },
  { name: 'Navrangpura Cross Roads Cam', lat: 23.03641, lng: 72.56107 },
  { name: 'Chiman bhai Bridge CSITMS-32_PTZ2', lat: 23.0708, lng: 72.5869 },
  { name: 'Visat teen Rasta', lat: 23.0981, lng: 72.5883 },
  { name: 'O.N.G.C. Office BS-103_B1', lat: 23.1055, lng: 72.5973 },
  { name: 'Visat P2', lat: 23.11926, lng: 72.56567 },
  { name: 'Tri Mandir Adalaj Tollnaka', lat: 23.16469, lng: 72.5821 },
]

/** Real great-circle distance in km. */
export function haversineKm(a: DemoCamera, b: DemoCamera): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export interface RouteHop {
  camera: DemoCamera
  /** Real distance from the previous hop, km. 0 for the first. */
  distanceKm: number
  /** Minutes after the first sighting. */
  minutesFromStart: number
  /** How this hop was identified. */
  matchedBy: 'plate' | 'vehicle-image'
  confidence: number
  timestamp: string
  /**
   * The radius, in km, the search had to reach to find this camera.
   * Greater than SEARCH_RADIUS_KM means this hop crossed a coverage gap.
   */
  foundWithinKm: number
}

/**
 * Search radius, in km, for finding the next camera along the corridor.
 * This is the proposal's stated 3-4 km rule.
 */
export const SEARCH_RADIUS_KM = 4

/**
 * When no camera is found within SEARCH_RADIUS_KM, the search widens in
 * steps rather than giving up. This is not a fudge to make the demo
 * look better — it reflects a real gap in the camera network: from
 * Navrangpura Cross Roads, the next camera north (Chiman bhai Bridge)
 * is 4.4 km away, just outside the nominal radius. A real system that
 * stopped dead there would lose the vehicle at the city centre. Each
 * widened hop is labelled in the UI so the operator can see the
 * confidence cost of a sparse coverage area.
 */
export const RADIUS_EXPANSION_STEPS_KM = [4, 6, 8]

/**
 * Walks the corridor outward from a starting camera, hopping to the
 * nearest not-yet-visited camera within SEARCH_RADIUS_KM. This is the
 * actual algorithm the proposal describes: once a vehicle is confirmed at
 * one camera, only nearby cameras need to be checked, which keeps the
 * search space (and the error rate) small.
 *
 * Distances are real. Which cameras "hit" is simulated.
 */
export function buildCorridorRoute(
  startCameraName: string,
  plateRecognised: boolean,
  startTime = new Date(),
): RouteHop[] {
  const start = DEMO_CAMERAS.find((c) => c.name === startCameraName) ?? DEMO_CAMERAS[0]
  const visited = new Set<string>([start.name])
  const hops: RouteHop[] = []

  let current = start
  let elapsedMin = 0

  const fmt = (minsFromStart: number) =>
    new Date(startTime.getTime() + minsFromStart * 60_000).toISOString()

  hops.push({
    camera: start,
    distanceKm: 0,
    minutesFromStart: 0,
    matchedBy: plateRecognised ? 'plate' : 'vehicle-image',
    // The starting camera is the one the officer supplied, so it is a
    // given, not a probabilistic match — shown as a full-confidence anchor.
    confidence: 1,
    timestamp: fmt(0),
    foundWithinKm: 0,
  })

  // Walk up to 5 further hops, always to the nearest unvisited camera
  // within the radius — the real proposed strategy.
  for (let i = 0; i < 5; i++) {
    // Only consider cameras that continue northward. Without this the
    // nearest-first walk doubles back on itself the moment no northern
    // camera is in range, producing a route that wanders rather than
    // travels — verified against the real coordinates before fixing.
    // A real implementation would use direction of travel inferred from
    // consecutive sightings; northward is this demo's stand-in for that.
    const northward = DEMO_CAMERAS.filter((c) => !visited.has(c.name) && c.lat > current.lat)

    // Widen the radius step by step until a camera is found, so a
    // coverage gap slows the search instead of ending it.
    let next: DemoCamera | undefined
    let foundWithinKm = 0
    for (const radius of RADIUS_EXPANSION_STEPS_KM) {
      const inRange = northward
        .filter((c) => haversineKm(current, c) <= radius)
        .sort((a, b) => haversineKm(current, a) - haversineKm(current, b))
      if (inRange.length > 0) {
        next = inRange[0]
        foundWithinKm = radius
        break
      }
    }

    if (!next) break

    const distanceKm = haversineKm(current, next)

    // Plausible urban travel: ~28 km/h average including signals, plus a
    // little variation so hop timings aren't suspiciously uniform.
    const travelMin = Math.max(2, Math.round((distanceKm / 28) * 60) + (i % 2))
    elapsedMin += travelMin

    // Plate reads stay high and stable; image-only matching degrades
    // as the vehicle gets further from the confirmed starting point —
    // which is exactly why the proposal asks for a last-seen camera.
    const baseConfidence = plateRecognised ? 0.97 - i * 0.015 : 0.91 - i * 0.045
    // Crossing a coverage gap means more unobserved road between
    // sightings, so the link to the previous hop is weaker.
    const gapPenalty = foundWithinKm > SEARCH_RADIUS_KM ? 0.06 : 0

    hops.push({
      camera: next,
      distanceKm,
      minutesFromStart: elapsedMin,
      matchedBy: plateRecognised ? 'plate' : 'vehicle-image',
      confidence: Number((baseConfidence - gapPenalty).toFixed(3)),
      timestamp: fmt(elapsedMin),
      foundWithinKm,
    })

    visited.add(next.name)
    current = next
  }

  return hops
}

export interface ProcessingStage {
  label: string
  detail: string
  /** How long this stage appears to take, ms. */
  durationMs: number
}

/**
 * The staged pipeline shown while "processing". Each stage names a real
 * step the proposed system would perform, so the demo teaches the
 * architecture rather than just spinning a loader.
 */
export function buildStages(plateProvided: boolean, plateRecognised: boolean): ProcessingStage[] {
  const stages: ProcessingStage[] = []

  if (plateProvided) {
    stages.push({
      label: 'Reading number plate',
      detail: 'Running ANPR on the uploaded image',
      durationMs: 1600,
    })
    if (plateRecognised) {
      stages.push({
        label: 'Matching against vehicle registry',
        detail: 'Cross-checking the plate with registered vehicle records',
        durationMs: 1400,
      })
    } else {
      stages.push({
        label: 'Plate unreadable — falling back',
        detail: 'No confident plate read; switching to visual vehicle matching',
        durationMs: 1500,
      })
    }
  }

  stages.push({
    label: plateRecognised ? 'Locating plate at the reported camera' : 'Building visual fingerprint',
    detail: plateRecognised
      ? 'Confirming the vehicle at the last-seen camera'
      : 'Generating a Re-ID embedding from the uploaded photo',
    durationMs: 1500,
  })

  stages.push({
    label: `Expanding search to cameras within ${SEARCH_RADIUS_KM} km`,
    detail: 'Querying neighbouring cameras outward from the confirmed sighting',
    durationMs: 2000,
  })

  stages.push({
    label: 'Reconstructing route',
    detail: 'Ordering confirmed sightings chronologically and checking travel plausibility',
    durationMs: 1500,
  })

  return stages
}

export interface WatchlistHit {
  plate: string
  reason: string
  caseRef: string
  raisedBy: string
  severity: 'high' | 'medium'
}

/**
 * Simulated police watchlist. A plate matching one of these triggers the
 * alert. Real ANPR + a real watchlist integration would replace this.
 */
export const DEMO_WATCHLIST: WatchlistHit[] = [
  {
    plate: 'GJ01AB1234',
    reason: 'Vehicle flagged in an active hit-and-run investigation',
    caseRef: 'FIR 0412/2026',
    raisedBy: 'Ahmedabad City Traffic Division',
    severity: 'high',
  },
  {
    plate: 'GJ05CD5678',
    reason: 'Reported stolen',
    caseRef: 'FIR 0388/2026',
    raisedBy: 'Vadodara City Police',
    severity: 'high',
  },
]

/** Normalises user input so 'gj 01 ab 1234' matches 'GJ01AB1234'. */
export function normalisePlate(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function findWatchlistHit(plate: string): WatchlistHit | undefined {
  const n = normalisePlate(plate)
  return DEMO_WATCHLIST.find((w) => normalisePlate(w.plate) === n)
}

/**
 * Shapes a simulated corridor walk into the same VehicleRouteResponse the
 * real backend returns, so the existing results page renders it through
 * its normal path — one map, one timeline, no parallel UI to maintain.
 *
 * The response is marked with `simulated` in router state (not here), so
 * the results page can label it without this module depending on the
 * page.
 */
export function buildRouteResponse(
  hops: RouteHop[],
  vehicleClass: string,
): VehicleRouteResponse {
  return {
    detections: [
      {
        vehicle_class: vehicleClass,
        // No real detector ran, so there is no genuine confidence score.
        // The existing results page already renders this case correctly.
        detection_confidence: null,
        used_whole_image_fallback: false,
        route_threshold_used: 0.9,
        route: hops.map((hop, i) => ({
          sighting_id: `sim-${i}`,
          camera_id: `sim-cam-${i}`,
          camera_name: hop.camera.name,
          latitude: hop.camera.lat,
          longitude: hop.camera.lng,
          detected_at: hop.timestamp,
          vehicle_class: vehicleClass,
          similarity: hop.confidence,
        })),
      },
    ],
  }
}
