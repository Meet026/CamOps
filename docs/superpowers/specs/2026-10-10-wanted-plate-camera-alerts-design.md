# Wanted-plate camera alerts — design spec

## Problem

Plates read from camera frames are stored on `vehicle_sighting.matched_plate`,
but nothing checks them against the wanted list. Wanted-list alerts only
happen when an officer types a plate into Vehicle Search. There is also no
way to add or resolve a wanted vehicle — existing rows were inserted directly.

## Goal

When any camera reads a plate that is on the active wanted list, officers get
a notification within seconds — at 80,000-camera scale, without querying the
database per plate read, without alert spam, and without missing a vehicle
that passed shortly before it was added to the list.

## Approach (agreed)

1. **In-memory list per worker.** Each ingest worker keeps the active wanted
   plates in memory (`normalized plate → wanted_vehicle_id`). A check is a
   dictionary lookup. Only plates that were actually read are checked.
2. **Instant push.** Adding or resolving a wanted vehicle sends a PostgreSQL
   `NOTIFY wanted_list_changed`; workers `LISTEN` and reload within ~1s.
3. **Refresh backup.** Workers also reload every 60s, covering any missed
   push (restart, network blip).
4. **Look-back on add.** Adding a wanted plate also searches stored sightings
   from the last 24h for that plate and alerts on each camera it was seen at
   ("seen before it was listed"). This closes the gap between a vehicle
   passing and the list updating.

## Why no Redis/Kafka

No queue system runs in this project today. PostgreSQL already provides both
pieces: the notification table is the durable queue (a match is a row; if the
API is down the row is still there when it comes back), and `LISTEN/NOTIFY` is
the push. This avoids new infrastructure. At much larger worker counts a
dedicated queue can replace the table without changing the flow.

## Components

### model1-service (NestJS — owns the schema)

- `POST /wanted-list` (admin): add `{ plateNumber, personName, crimeDetails }`.
  Plate normalized with the existing `plate-number.util`. Rejects a duplicate
  active plate (409). Audited. Then: `NOTIFY`, then the look-back.
- `POST /wanted-list/:id/resolve` (admin): status `resolved`, `resolved_at`
  set. Audited. Then `NOTIFY`. Resolved plates stop alerting.
- `GET /wanted-list?status=active|resolved` (admin): list.
- `wanted_list_notification` gains nullable columns: `camera_id`,
  `vehicle_sighting_id`, `seen_at`, `plate_confidence`. New `source` values:
  `camera_live`, `camera_lookback` (alongside `manual_search`). Prisma
  migration; existing rows untouched.
- Notification list returns camera name and `seen_at` for camera alerts.

### vehicle-ingest (Python — the camera workers)

- `WantedPlateWatcher`: loads active plates at startup, `LISTEN`s on a
  background thread and reloads on notify, reloads every 60s regardless.
  `/health` reports plate count and last refresh time.
- After a sighting with a plate is saved, the watcher checks it. On a match,
  insert a `camera_live` notification — **deduplicated**: skipped if the same
  wanted vehicle already alerted from the same camera in the last 10 minutes.
  Dedupe runs inside one SQL statement under a per-(vehicle, camera) advisory
  lock, so the two ingest loops can't double-alert.
- A watcher failure never stops ingest; it is reported on `/health`.

### frontend

- **Wanted List page** (admin): active/resolved tabs, add form, resolve button.
- **Notification bell**: camera alerts show plate, person, camera, time seen,
  plate-read confidence, and the label "Possible match — verify before
  acting". Look-back alerts say "seen before it was added to the list".

## Known limitations (stated, not hidden)

- **No snapshot image.** Frames are deleted right after analysis (existing
  no-raw-frame-retention rule). Alerts carry camera, time and confidence only.
- **Live alerts depend on plates being read.** On today's wide junction
  cameras plates are rarely legible, so live alerts will be rare until
  lane-facing cameras exist. The flow is tested with stored plate data.
- A plate misread can still produce a wrong alert, which is why every alert is
  marked "verify before acting" and plate reads below the confidence floor are
  never stored.

## Testing

- TDD for every unit: watcher (load, reload on notify, refresh, failure),
  dedupe, look-back, the new endpoints, the migration.
- Real-DB tests isolated and self-cleaning.
- Live end-to-end via the real APIs and a browser: add a wanted plate that has
  prior sightings → look-back alert appears in the bell; feed a plate read
  through the real ingest check → live alert, repeated read → no duplicate;
  resolve → no further alerts. Before/after regression of every existing
  endpoint touched.
