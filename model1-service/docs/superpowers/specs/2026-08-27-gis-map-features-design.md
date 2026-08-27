# GIS & Map Features (FR-5, partial) — Design

## Scope

Three of FR-5's four endpoints: `GET /gis/cameras-in-bounds`,
`GET /gis/gap-analysis`, `GET /gis/heatmap`.

**`GET /gis/overlap-detection` is explicitly deferred** — decided during
brainstorming. It's a well-specified feature (the LLD already gives the
exact query), but the user chose to set it aside as a future enhancement
rather than build it in this pass. No overlap-detection code, DTO, or
route is created by this design.

Map clustering (aggregating pins into district/region-level counts at wide
zoom levels, only showing individual pins once zoomed into a smaller area)
was also considered and explicitly deferred — `cameras-in-bounds` always
returns individual pins for whatever bounding box is requested, with no
server-side aggregation. If a full-state view needs to avoid rendering
thousands of individual pins, that's left to either client-side clustering
(a common split — many map libraries, including Leaflet, have a clustering
plugin) or a future backend enhancement.

## Module Layout

```
src/gis/
├── gis.module.ts
├── gis.controller.ts        # GET /gis/cameras-in-bounds, /gap-analysis, /heatmap
├── gis.service.ts           # cameras-in-bounds + gap-analysis
├── heatmap-sample-data.ts   # small hardcoded array of sample incident points
└── dto/
    ├── map-bounds-query.dto.ts   # minLat, minLng, maxLat, maxLng — shared
    └── gap-analysis-query.dto.ts # extends map-bounds-query, adds optional gridSize
```

## `GET /gis/cameras-in-bounds` — roles: all, dept_viewer scoped

Query params (`MapBoundsQueryDto`): `minLat`, `minLng`, `maxLat`, `maxLng`
(all required, validated as real lat/long values via
`@IsLatitude()`/`@IsLongitude()`, with `minLat < maxLat` and
`minLng < maxLng` enforced — a 400 on an inverted/degenerate box).

Query: `WHERE ST_Within(location_geo::geometry, ST_MakeEnvelope(minLng,
minLat, maxLng, maxLat, 4326)) AND is_active = true`, via `$queryRaw`
(PostGIS spatial functions aren't expressible through Prisma's query
builder — this is a project-wide, already-established rule). Uses the
existing `GIST(location_geo)` index. `applyDeptScope` is applied for
dept_viewer, same helper used everywhere else.

**Response shape per pin**: `{ cameraId, name, latitude, longitude,
departmentId, cameraType, currentStatus, integrationScore }` — enough to
render and color/filter a pin (by department, status, or integration
score, per the PRD's frontend plan) without the weight of a full
`CameraRecord` (no brand/model/addressText/onvifSource/dataConfidence/
photoUrl/timestamps).

## `GET /gis/gap-analysis` — roles: admin, field_officer

Query params (`GapAnalysisQueryDto extends MapBoundsQueryDto`): the same
four bounds fields, plus optional `gridSize` (default from
`GIS_GAP_ANALYSIS_DEFAULT_GRID_SIZE` env var, default `10`;
`@Max(50)` — capped since a 50×50 grid (2,500 cells) is already dense
detail at any zoom level, and an uncapped value risks a slow query and an
oversized response for no real analytical benefit).

**Mechanics**:
1. Application code divides the requested bounding box into
   `gridSize × gridSize` equal-sized rectangular cells (plain arithmetic —
   `(maxLat - minLat) / gridSize` per row, same for longitude/columns; no
   DB round-trip for this step).
2. One single grouped SQL query assigns every active camera inside the
   bounding box to a cell and counts per cell, in one `$queryRaw` call
   covering all cells at once (never `gridSize²` separate queries — that
   would scale badly). Concretely: `floor((longitude - minLng) / cellWidth)`
   and `floor((latitude - minLat) / cellHeight)` computed per camera row
   give integer column/row indices (clamped to `gridSize - 1` for a camera
   exactly on the box's max edge), `GROUP BY` those two computed columns
   gives a camera count per occupied cell in one pass. Application code
   then computes the full `gridSize × gridSize` set of cell coordinates and
   diffs it against the occupied-cell set returned by the query — any cell
   absent from the query result (count of zero, never having appeared in
   `GROUP BY` output) is a gap.
3. Any cell with a camera count of zero is returned as a gap:
   `{ minLat, minLng, maxLat, maxLng }` (that cell's own corner
   coordinates), so the frontend can shade/highlight it directly.

**Response shape**: `{ gridSize, gaps: [{ minLat, minLng, maxLat, maxLng
}, ...] }` — a bare array wrapped with the echoed `gridSize` so the
frontend doesn't need to separately track what grid density produced the
result.

## `GET /gis/heatmap` — roles: admin, field_officer

No query params, no database query at all — purely static. Returns a
small hardcoded array from `heatmap-sample-data.ts`
(`{ latitude, longitude, weight }[]`, weight meaning relative
intensity/frequency for the frontend's heatmap-rendering library to
color), with points placed at real Gujarat coordinates so it renders
sensibly if actually plotted. This is a proof-of-concept overlay standing
in for a real incident-tracking system that doesn't exist in this
project — not connected to any persisted data, and not intended to be.

**Response shape**: `{ beta: true, label: "Beta: Incident density overlay
(sample data)", points: [{ latitude, longitude, weight }, ...] }` — the
`beta`/`label` fields exist specifically so the frontend has an explicit,
unambiguous signal to render the PRD-required "Beta" badge, rather than
inferring it from context.

## Configuration

New env var, following the project's existing pattern:
- `GIS_GAP_ANALYSIS_DEFAULT_GRID_SIZE` (default `10`)

## Error Handling

- An inverted or degenerate bounding box (`minLat >= maxLat` or
  `minLng >= maxLng`) is a `400 Bad Request` — validated explicitly, not
  left to silently return an empty/nonsensical result.
- `gridSize` above 50 or below 1 is a `400` via class-validator's
  `@Max(50)`/`@Min(1)`, same defensive-limits pattern as pagination's
  `@Max(100)` elsewhere in this codebase.
- No AI/external-provider dependency in this feature — nothing here can
  fail due to a third-party outage.

## Testing

Same TDD discipline as prior modules. `gis.service.ts`'s spatial queries
are unit-tested with `PrismaService.$queryRaw` mocked (asserting the SQL
fragment shape, matching the existing pattern used for camera-registry's
own raw-SQL queries), plus a real e2e test seeding actual cameras at known
coordinates and querying real bounding boxes/grids against the live
PostGIS-backed database — spatial correctness (does `ST_Within` actually
include/exclude the right cameras) can only be meaningfully verified
against a real PostGIS instance, not a mock. `heatmap` needs no database
mocking at all — it's tested purely as a static-response function.
