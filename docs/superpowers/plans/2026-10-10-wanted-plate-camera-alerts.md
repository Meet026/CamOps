# Wanted-Plate Camera Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alert officers when any camera reads a plate that is on the active wanted list, and let admins add/resolve wanted vehicles.

**Architecture:** Each vehicle-ingest worker holds the active wanted plates in memory, reloaded instantly via PostgreSQL `LISTEN/NOTIFY` (fired by a DB trigger on `wanted_vehicle`) and every 60s as a backup. A plate read that matches inserts a deduplicated `camera_live` row into `wanted_list_notification`, which the existing bell already polls. Adding a wanted vehicle through model1-service also runs a 24h look-back over stored sightings.

**Tech Stack:** NestJS + Prisma (model1-service), Python 3.12 + psycopg2 (vehicle-ingest, vehicle-detection), React + TanStack Query (frontend), PostgreSQL (Neon).

**Spec:** `docs/superpowers/specs/2026-10-10-wanted-plate-camera-alerts-design.md`. Deviation agreed in chat: the instant push is sent by a database trigger (fires for any writer), not by the API.

## Global Constraints

- Plate normalization everywhere: uppercase, strip spaces/hyphens/underscores (`normalizePlateNumber` in TS, `normalize_plate` in Python must agree).
- Dedupe window: same wanted vehicle + same camera alerts at most once per **10 minutes**.
- Look-back window: **24 hours**; one notification per camera (latest sighting there).
- Refresh backup interval: **60 seconds**.
- New `source` values: `camera_live`, `camera_lookback` (existing `manual_search` unchanged).
- Add/resolve/list wanted vehicles: **admin only**, audited.
- Every camera alert is shown as "Possible match — verify before acting".
- A watcher/alert failure must never stop ingest.
- Writes to the shared live database (migration, test rows) require the user's explicit approval at that step; test rows are tagged and deleted.

## Review Focus

1. **Formatting differences** — a wanted plate added as `gj-01 ab 1234` must match a camera read `GJ01AB1234`. Pinned in Task 2 (normalized on store) and Task 5 (normalized on load).
2. **Resolve while live** — after resolve, the plate must stop alerting (push reload) and the dedupe SQL must also refuse resolved vehicles. Pinned in Task 6 (`record_live_alert` checks `status='active'`).
3. **Car parked in front of a camera** — repeated reads every few seconds produce one alert per 10 minutes, even when both ingest loops read it at once. Pinned in Task 6 (dedupe + concurrency test).
4. **Database drops the LISTEN connection** (Neon idles connections) — the watcher must reconnect and keep alerting rather than silently stop. Pinned in Task 5 (reconnect test).
5. **Adding a plate that is already active** — 409, no duplicate row, even under a race; re-adding after resolve is allowed. Pinned in Task 1 (partial unique index) and Task 2 (409 mapping).

---

## File Structure

| File | Responsibility |
|---|---|
| `model1-service/prisma/migrations/20261010120000_wanted_camera_alerts/migration.sql` | New notification columns, indexes, active-plate uniqueness, NOTIFY trigger |
| `model1-service/prisma/schema.prisma` | Mirror the new columns |
| `model1-service/src/wanted-list/dto/create-wanted-vehicle.dto.ts` | Validate add input |
| `model1-service/src/wanted-list/wanted-list.service.ts` | `listWanted`, `createWanted`, `resolveWanted` |
| `model1-service/src/wanted-list/wanted-list.controller.ts` | `GET/POST /wanted-list`, `POST /wanted-list/:id/resolve` |
| `model1-service/src/wanted-list/wanted-notification.service.ts` | `createLookbackNotifications`, camera fields in listing |
| `AI Registry/vehicle-detection/src/pipeline.py` | Report saved plate reads |
| `AI Registry/vehicle-ingest/src/wanted_watcher.py` | In-memory active plates, LISTEN + refresh |
| `AI Registry/vehicle-ingest/src/wanted_alerts.py` | Deduplicated `camera_live` insert |
| `AI Registry/vehicle-ingest/src/ingest_cycle.py`, `motion_gated_cycle.py`, `main.py` | Wire watcher + alerts in |
| `frontend/src/api/wantedList.ts`, `frontend/src/types/api.ts` | Wanted list API + types |
| `frontend/src/pages/wanted-list/WantedListPage.tsx` | Admin page |
| `frontend/src/components/layout/NotificationBell.tsx` | Render camera alerts |

---

### Task 1: Database migration

**Files:**
- Create: `model1-service/prisma/migrations/20261010120000_wanted_camera_alerts/migration.sql`
- Modify: `model1-service/prisma/schema.prisma` (`WantedListNotification` model)

**Interfaces:**
- Produces: columns `wanted_list_notification.camera_id uuid NULL`, `vehicle_sighting_id uuid NULL`, `seen_at timestamptz NULL`, `plate_confidence double precision NULL`; channel `wanted_list_changed`; unique index `uq_wanted_vehicle_active_plate`; unique index `uq_wanted_notification_sighting`.

- [ ] **Step 1: Check existing data won't violate the new unique index**

Run (read-only):
```sql
SELECT plate_number, count(*) FROM wanted_vehicle WHERE status='active' GROUP BY 1 HAVING count(*) > 1;
```
Expected: no rows. If any, stop and report to the user.

- [ ] **Step 2: Write the migration**

```sql
-- Camera-originated wanted-list alerts (see the 2026-10-10 spec).
ALTER TABLE "wanted_list_notification"
  ADD COLUMN "camera_id" UUID,
  ADD COLUMN "vehicle_sighting_id" UUID,
  ADD COLUMN "seen_at" TIMESTAMPTZ,
  ADD COLUMN "plate_confidence" DOUBLE PRECISION;

-- vehicle_sighting is owned by the AI Registry services (not Prisma), so no
-- FK to it; camera is Prisma-owned.
ALTER TABLE "wanted_list_notification" ADD CONSTRAINT "wanted_list_notification_camera_id_fkey"
  FOREIGN KEY ("camera_id") REFERENCES "camera"("camera_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Dedupe lookups: "did this vehicle already alert from this camera recently?"
CREATE INDEX "idx_wanted_notification_dedupe"
  ON "wanted_list_notification"("wanted_vehicle_id", "camera_id", "created_at" DESC);

-- One alert per sighting, ever — protects look-back and live from double-inserting.
CREATE UNIQUE INDEX "uq_wanted_notification_sighting"
  ON "wanted_list_notification"("wanted_vehicle_id", "vehicle_sighting_id")
  WHERE "vehicle_sighting_id" IS NOT NULL;

-- A plate can be active at most once; re-adding after resolve is allowed.
CREATE UNIQUE INDEX "uq_wanted_vehicle_active_plate"
  ON "wanted_vehicle"("plate_number") WHERE "status" = 'active';

-- Instant push to ingest workers for ANY writer (this app or a department sync).
CREATE OR REPLACE FUNCTION notify_wanted_list_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('wanted_list_changed', COALESCE(NEW.wanted_vehicle_id, OLD.wanted_vehicle_id)::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "wanted_vehicle_changed"
  AFTER INSERT OR DELETE OR UPDATE OF "status", "plate_number" ON "wanted_vehicle"
  FOR EACH ROW EXECUTE FUNCTION notify_wanted_list_changed();
```

- [ ] **Step 3: Mirror columns in `schema.prisma`** (inside `model WantedListNotification`, after `matchedPlateNumber`)

```prisma
  // Camera-originated alerts only (source camera_live / camera_lookback).
  cameraId          String?   @map("camera_id") @db.Uuid
  vehicleSightingId String?   @map("vehicle_sighting_id") @db.Uuid
  seenAt            DateTime? @map("seen_at") @db.Timestamptz
  plateConfidence   Float?    @map("plate_confidence")

  camera Camera? @relation(fields: [cameraId], references: [cameraId], onDelete: SetNull)
```
and add `wantedListNotifications WantedListNotification[]` to `model Camera`. Update the `source` comment to list the three values.

- [ ] **Step 4: Validate** — `npx prisma validate` → "The schema ... is valid"; `npx prisma generate` succeeds; `npm test` still 337 passing.

- [ ] **Step 5: Apply to the live DB — ASK THE USER FIRST.** On approval: `npx prisma migrate deploy`. Verify: the 4 columns exist; `SELECT tgname FROM pg_trigger WHERE tgname='wanted_vehicle_changed'` returns 1 row; a session running `LISTEN wanted_list_changed` receives a payload when a tagged test wanted row (`GJTRIG<random>`) is inserted, and again when it is deleted.

- [ ] **Step 6: Commit** — `git add prisma/ && git commit -m "feat(wanted-list): schema for camera alerts and change notifications"`

---

### Task 2: Add / resolve / list wanted vehicles (model1-service)

**Files:**
- Create: `model1-service/src/wanted-list/dto/create-wanted-vehicle.dto.ts`, `model1-service/src/wanted-list/dto/wanted-list-query.dto.ts`
- Modify: `wanted-list.service.ts`, `wanted-list.controller.ts`, `wanted-list.types.ts`, `wanted-list.module.ts`
- Test: `wanted-list.service.spec.ts`, `wanted-list.controller.spec.ts`

**Interfaces:**
- Consumes: `WantedNotificationService.createLookbackNotifications(wantedVehicleId: string, plate: string): Promise<number>` (Task 3; mock it here).
- Produces: `WantedListService.listWanted(status?: 'active'|'resolved'): Promise<WantedVehicleRecord[]>`, `createWanted(request, dto): Promise<WantedVehicleRecord>`, `resolveWanted(request, id): Promise<WantedVehicleRecord>`; `createWanted` returns `WantedVehicleRecord & { lookbackAlerts: number }`; HTTP `GET /api/v1/wanted-list?status=`, `POST /api/v1/wanted-list` (201 with `lookbackAlerts`, 409 duplicate active plate), `POST /api/v1/wanted-list/:id/resolve` (200, 404 unknown, 409 already resolved).

- [ ] **Step 1: Failing service tests** (add to `wanted-list.service.spec.ts`; extend the providers with `{ provide: AuditContextService, useValue: { setChanges: jest.fn() } }`)

```ts
describe('createWanted', () => {
  const request = {} as any;
  it('stores the plate normalized', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ ...fakeRow, plate_number: 'GJ01AB1234' }]);
    await service.createWanted(request, { plateNumber: 'gj-01 ab 1234', personName: 'A', crimeDetails: 'B' });
    const sql = prisma.$queryRaw.mock.calls[0][0];
    expect(sql.values).toContain('GJ01AB1234');
  });
  it('maps a duplicate active plate to 409', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2010', meta: { code: '23505' } }));
    await expect(service.createWanted(request, { plateNumber: 'GJ01AB1234', personName: 'A', crimeDetails: 'B' }))
      .rejects.toBeInstanceOf(ConflictException);
  });
  it('rejects a plate that is empty after normalization', async () => {
    await expect(service.createWanted(request, { plateNumber: ' - ', personName: 'A', crimeDetails: 'B' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
describe('resolveWanted', () => {
  it('404s an unknown id', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.resolveWanted({} as any, '00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('409s an already-resolved vehicle', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ ...fakeRow, status: 'resolved' }]);
    await expect(service.resolveWanted({} as any, 'wv-1')).rejects.toBeInstanceOf(ConflictException);
  });
});
```

- [ ] **Step 2: Run** `npx jest wanted-list.service` → FAIL (`createWanted is not a function`).

- [ ] **Step 3: Implement** in `wanted-list.service.ts` (replace the read-only comment with: "Admins maintain the list here; the DB trigger notifies camera workers of every change."):

```ts
const WANTED_COLUMNS = Prisma.sql`wanted_vehicle_id, person_name, plate_number, crime_details,
  status, department_id, created_at, updated_at, resolved_at`;

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; meta?: { code?: string } };
  return err?.code === '23505' || err?.meta?.code === '23505';
}

async listWanted(status?: WantedVehicleStatus): Promise<WantedVehicleRecord[]> {
  const rows = await this.prisma.$queryRaw<RawWantedVehicleRow[]>(Prisma.sql`
    SELECT ${WANTED_COLUMNS} FROM wanted_vehicle
    ${status ? Prisma.sql`WHERE status = ${status}` : Prisma.empty}
    ORDER BY created_at DESC LIMIT 500`);
  return rows.map(mapRow);
}

async createWanted(request: Request, dto: CreateWantedVehicleDto): Promise<WantedVehicleRecord> {
  const plate = normalizePlateNumber(dto.plateNumber);
  if (!plate) throw new BadRequestException('plateNumber must contain letters or digits');
  let rows: RawWantedVehicleRow[];
  try {
    rows = await this.prisma.$queryRaw<RawWantedVehicleRow[]>(Prisma.sql`
      INSERT INTO wanted_vehicle (person_name, plate_number, crime_details)
      VALUES (${dto.personName.trim()}, ${plate}, ${dto.crimeDetails.trim()})
      RETURNING ${WANTED_COLUMNS}`);
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictException(`${plate} is already on the active wanted list`);
    throw e;
  }
  const record = mapRow(rows[0]);
  this.auditContext.setChanges(request, null, { plateNumber: plate, personName: record.personName }, record.wantedVehicleId);
  const lookbackAlerts = await this.notificationService.createLookbackNotifications(record.wantedVehicleId, plate);
  return { ...record, lookbackAlerts };
}

async resolveWanted(request: Request, id: string): Promise<WantedVehicleRecord> {
  const existing = await this.prisma.$queryRaw<RawWantedVehicleRow[]>(Prisma.sql`
    SELECT ${WANTED_COLUMNS} FROM wanted_vehicle WHERE wanted_vehicle_id = ${id}::uuid`);
  if (existing.length === 0) throw new NotFoundException('Wanted vehicle not found');
  if (existing[0].status === 'resolved') throw new ConflictException('Already resolved');
  const rows = await this.prisma.$queryRaw<RawWantedVehicleRow[]>(Prisma.sql`
    UPDATE wanted_vehicle SET status = 'resolved', resolved_at = now(), updated_at = now()
    WHERE wanted_vehicle_id = ${id}::uuid RETURNING ${WANTED_COLUMNS}`);
  this.auditContext.setChanges(request, { status: 'active' }, { status: 'resolved' }, id);
  return mapRow(rows[0]);
}
```
Constructor gains `private readonly auditContext: AuditContextService, private readonly notificationService: WantedNotificationService`. DTO:

```ts
export class CreateWantedVehicleDto {
  @IsString() @IsNotEmpty() @MaxLength(20) plateNumber!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) personName!: string;
  @IsString() @IsNotEmpty() @MaxLength(1000) crimeDetails!: string;
}
export class WantedListQueryDto {
  @IsOptional() @IsIn(['active', 'resolved']) status?: 'active' | 'resolved';
}
```

Controller (declare `check-plate` first; then):
```ts
@Roles('admin') @Get()
list(@Query() q: WantedListQueryDto) { return this.wantedListService.listWanted(q.status); }

@Roles('admin') @Audit('create_wanted_vehicle', 'wanted_vehicle') @HttpCode(HttpStatus.CREATED) @Post()
create(@Req() req: Request, @Body() dto: CreateWantedVehicleDto) { return this.wantedListService.createWanted(req, dto); }

@Roles('admin') @Audit('resolve_wanted_vehicle', 'wanted_vehicle') @Post(':id/resolve')
resolve(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) { return this.wantedListService.resolveWanted(req, id); }
```
Update the controller's header comment to match.

- [ ] **Step 4: Controller tests** — one per route asserting the service is called with the right args (same style as the existing `checkPlate` test).
- [ ] **Step 5: Run** `npx jest wanted-list` → PASS; `npm test` → all pass.
- [ ] **Step 6: Commit** — `git commit -m "feat(wanted-list): admin add/resolve/list wanted vehicles"`

---

### Task 3: Look-back and camera fields in notifications (model1-service)

**Files:**
- Modify: `wanted-notification.service.ts`, `wanted-list.types.ts`
- Test: `wanted-notification.service.spec.ts`

**Interfaces:**
- Produces: `createLookbackNotifications(wantedVehicleId: string, plate: string): Promise<number>` (rows inserted); `WantedListNotificationRecord` gains `cameraId: string | null`, `cameraName: string | null`, `seenAt: Date | null`, `plateConfidence: number | null`; `NotificationSource = 'manual_search' | 'camera_live' | 'camera_lookback'`.

- [ ] **Step 1: Failing tests**

```ts
it('look-back inserts one row per camera from the last 24h, ignoring duplicates', async () => {
  prisma.$queryRaw.mockResolvedValueOnce([{ inserted: 2 }]);
  await expect(service.createLookbackNotifications('wv-1', 'GJ01AB1234')).resolves.toBe(2);
  const sql = prisma.$queryRaw.mock.calls[0][0];
  expect(sql.sql).toContain("'camera_lookback'");
  expect(sql.sql).toContain("interval '24 hours'");
  expect(sql.sql).toContain('DISTINCT ON');
  expect(sql.sql).toContain('ON CONFLICT DO NOTHING');
  expect(sql.values).toEqual(expect.arrayContaining(['wv-1', 'GJ01AB1234']));
});
it('maps camera fields when listing', async () => {
  prisma.$queryRaw.mockResolvedValueOnce([{ ...baseRow, source: 'camera_live', camera_id: 'c1', camera_name: 'Paldi Circle', seen_at: new Date(), plate_confidence: 0.82 }]);
  const items = await service.listNotifications({} as any);
  expect(items[0]).toMatchObject({ source: 'camera_live', cameraName: 'Paldi Circle', plateConfidence: 0.82 });
});
```
(`listNotifications` returns `WantedListNotificationRecord[]`; if it turns out to return a paged object, index into its items array instead — do not change its return shape.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
async createLookbackNotifications(wantedVehicleId: string, plate: string): Promise<number> {
  const rows = await this.prisma.$queryRaw<{ inserted: number }[]>(Prisma.sql`
    WITH latest AS (
      SELECT DISTINCT ON (vs.camera_id)
        vs.vehicle_sighting_id, vs.camera_id, vs.detected_at, vs.plate_confidence
      FROM vehicle_sighting vs
      WHERE vs.matched_plate = ${plate}
        AND vs.detected_at > now() - interval '24 hours'
      ORDER BY vs.camera_id, vs.detected_at DESC
    ), ins AS (
      INSERT INTO wanted_list_notification
        (wanted_vehicle_id, source, matched_plate_number, camera_id, vehicle_sighting_id, seen_at, plate_confidence)
      SELECT ${wantedVehicleId}::uuid, 'camera_lookback', ${plate}, camera_id, vehicle_sighting_id, detected_at, plate_confidence
      FROM latest
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT count(*)::int AS inserted FROM ins`);
  return rows[0]?.inserted ?? 0;
}
```
`NOTIFICATION_SELECT_SQL` adds `n.camera_id, n.seen_at, n.plate_confidence, c.name AS camera_name` and `LEFT JOIN camera c ON c.camera_id = n.camera_id`; `mapRow` maps them (`plateConfidence: row.plate_confidence === null ? null : Number(row.plate_confidence)`).

- [ ] **Step 4: Run** `npm test` → all pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(wanted-list): 24h look-back alerts and camera fields on notifications"`

---

### Task 4: Pipeline reports saved plate reads (vehicle-detection)

**Files:** Modify `AI Registry/vehicle-detection/src/pipeline.py`; Test `tests/test_pipeline.py`

**Interfaces:**
- Produces: `PipelineResult.saved_plate_reads: list[tuple[str, str, float]]` — `(sighting_id, plate, confidence)` for each saved sighting that has a plate.

- [ ] **Step 1: Failing test**

```python
def test_saved_plate_reads_lists_only_sightings_with_a_plate():
    detector = FakeDetector([[_fake_detection(), _fake_detection()]])
    reads = iter([("GJ01AB1234", 0.9), None])
    result = run_pipeline(["/fake/i.jpg"], "camera-1", detector, FakeEmbedder(), FakeStore(),
                          plate_reader=lambda crop: next(reads))
    assert result.saved_plate_reads == [("fake-id-0", "GJ01AB1234", 0.9)]
```
- [ ] **Step 2: Run** `pytest tests/test_pipeline.py -q` → FAIL (`no attribute saved_plate_reads`).
- [ ] **Step 3: Implement** — `self.saved_plate_reads = []` in `PipelineResult.__init__`; after `result.add_saved(sighting_id)`: `if matched_plate is not None: result.saved_plate_reads.append((sighting_id, matched_plate, plate_confidence))`.
- [ ] **Step 4: Run** full suite → pass (only the pre-existing 0.80 threshold test may fail; it fails on untouched code).
- [ ] **Step 5: Commit** — `git commit -m "feat(vehicle-detection): report saved plate reads from the pipeline"`

---

### Task 5: In-memory wanted plates with LISTEN + refresh (vehicle-ingest)

**Files:** Create `AI Registry/vehicle-ingest/src/wanted_watcher.py`; Test `tests/test_wanted_watcher.py`

**Interfaces:**
- Produces: `normalize_plate(s: str) -> str`; `class WantedPlateWatcher(load_active: Callable[[], dict[str, str]], listen_connect: Callable[[], connection] | None, refresh_seconds: float = 60.0)` with `reload() -> None`, `lookup(plate: str) -> str | None` (wanted_vehicle_id), `start() -> None`, `stop() -> None`, `status() -> dict` (`{"plates": int, "last_refresh": iso str | None, "last_error": str | None}`); `load_active_from_db(connect) -> dict[str, str]`.

- [ ] **Step 1: Failing tests**

```python
from src.wanted_watcher import WantedPlateWatcher, normalize_plate

def test_lookup_matches_regardless_of_formatting():
    w = WantedPlateWatcher(load_active=lambda: {normalize_plate("gj-01 ab 1234"): "wv-1"}, listen_connect=None)
    w.reload()
    assert w.lookup("GJ01AB1234") == "wv-1"
    assert w.lookup("gj01ab1234") == "wv-1"
    assert w.lookup("GJ05ZZ9999") is None

def test_failed_reload_keeps_the_last_good_list_and_reports_the_error():
    calls = iter([{"GJ01AB1234": "wv-1"}, RuntimeError("db down")])
    def load():
        v = next(calls)
        if isinstance(v, Exception): raise v
        return v
    w = WantedPlateWatcher(load_active=load, listen_connect=None)
    w.reload(); w.reload()
    assert w.lookup("GJ01AB1234") == "wv-1"
    assert "db down" in w.status()["last_error"]

def test_periodic_refresh_picks_up_a_new_plate_without_any_notify():
    lists = [{}, {"GJ01AB1234": "wv-1"}]
    w = WantedPlateWatcher(load_active=lambda: lists[min(w._loads, 1)], listen_connect=None, refresh_seconds=0.05)
    w.start()
    try:
        _wait_until(lambda: w.lookup("GJ01AB1234") == "wv-1", timeout=2)
    finally:
        w.stop()
```
plus a real-DB test (gated by `VEHICLE_DETECTION_TEST_DATABASE_URL`) that starts the watcher with a 60s refresh, inserts a tagged wanted row `GJTW<random>`, asserts `lookup` finds it within 3s (proves NOTIFY, not refresh), deletes the row, asserts it disappears within 3s; and a reconnect test that terminates the LISTEN backend via `pg_terminate_backend` and asserts a later insert is still picked up within 5s. `_wait_until` polls every 20ms.

- [ ] **Step 2: Run** → FAIL (module missing).
- [ ] **Step 3: Implement**

```python
import re, select, threading, datetime

def normalize_plate(s: str) -> str:
    return re.sub(r"[\s\-_]", "", s or "").upper()

def load_active_from_db(connect) -> dict[str, str]:
    conn = connect()
    try:
        cur = conn.cursor()
        cur.execute("SELECT plate_number, wanted_vehicle_id FROM wanted_vehicle WHERE status = 'active'")
        return {normalize_plate(p): str(i) for p, i in cur.fetchall()}
    finally:
        conn.close()

class WantedPlateWatcher:
    def __init__(self, load_active, listen_connect, refresh_seconds=60.0):
        self._load_active = load_active
        self._listen_connect = listen_connect
        self._refresh_seconds = refresh_seconds
        self._plates: dict[str, str] = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self._loads = 0
        self._last_refresh = None
        self._last_error = None

    def reload(self):
        try:
            plates = self._load_active()
        except Exception as e:  # noqa: BLE001 -- keep the last good list
            self._last_error = f"reload failed: {e}"
            return
        with self._lock:
            self._plates = plates
        self._loads += 1
        self._last_refresh = datetime.datetime.now(datetime.timezone.utc)
        self._last_error = None

    def lookup(self, plate):
        with self._lock:
            return self._plates.get(normalize_plate(plate))

    def status(self):
        with self._lock:
            n = len(self._plates)
        return {"plates": n, "last_refresh": self._last_refresh.isoformat() if self._last_refresh else None,
                "last_error": self._last_error}

    def start(self):
        self.reload()
        self._thread = threading.Thread(target=self._run, name="wanted-watcher", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    def _run(self):
        conn = None
        while not self._stop.is_set():
            try:
                if conn is None and self._listen_connect is not None:
                    conn = self._listen_connect()
                    conn.autocommit = True
                    conn.cursor().execute("LISTEN wanted_list_changed")
                    self.reload()  # catch anything changed while disconnected
                if conn is None:
                    self._stop.wait(self._refresh_seconds)
                    self.reload()
                    continue
                ready, _, _ = select.select([conn], [], [], self._refresh_seconds)
                if ready:
                    conn.poll()
                    conn.notifies.clear()
                self.reload()  # on notify, or every refresh_seconds
            except Exception as e:  # noqa: BLE001 -- reconnect, never die
                self._last_error = f"listen connection lost: {e}"
                try:
                    conn and conn.close()
                except Exception:  # noqa: BLE001
                    pass
                conn = None
                self._stop.wait(2.0)
```

- [ ] **Step 4: Run** unit + real-DB tests (real-DB **with user approval**, rows tagged `GJTW...`, deleted in `finally`) → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(vehicle-ingest): in-memory wanted plates with LISTEN/NOTIFY and refresh"`

---

### Task 6: Deduplicated live alerts + wiring (vehicle-ingest)

**Files:** Create `src/wanted_alerts.py`; Modify `src/ingest_cycle.py`, `src/motion_gated_cycle.py`, `src/main.py`; Tests `tests/test_wanted_alerts.py`, `tests/test_ingest_cycle.py`, `tests/test_motion_gated_cycle.py`

**Interfaces:**
- Consumes: `WantedPlateWatcher.lookup`, `PipelineResult.saved_plate_reads`.
- Produces: `record_live_alert(conn, wanted_vehicle_id, camera_id, sighting_id, plate, confidence, dedupe_minutes=10) -> bool`; `class WantedAlerter(watcher, connect)` with `handle(camera_id: str, saved_plate_reads) -> int` (alerts created); cycles accept `wanted_alerter=None`.

- [ ] **Step 1: Failing unit tests for `WantedAlerter`** (fake watcher + fake recorder): a read whose plate isn't wanted creates nothing; a wanted read calls the recorder once with the right ids; a recorder exception is swallowed and counted in `status()["last_error"]` (ingest must not stop).
- [ ] **Step 2: Failing real-DB tests for `record_live_alert`** (gated, approved, tagged): first call → True and one `camera_live` row with camera/sighting/seen_at/confidence; second call same vehicle+camera within 10 min → False; a different camera → True; a resolved vehicle → False; 10 threads calling at once → exactly one row. Tests delete their wanted row (notifications cascade).
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement**

```python
LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext(%(wv)s || ':' || %(cam)s))"

INSERT_SQL = """
INSERT INTO wanted_list_notification
  (wanted_vehicle_id, source, matched_plate_number, camera_id, vehicle_sighting_id, seen_at, plate_confidence)
SELECT %(wv)s::uuid, 'camera_live', %(plate)s, %(cam)s::uuid, %(sid)s::uuid, now(), %(conf)s
WHERE EXISTS (SELECT 1 FROM wanted_vehicle WHERE wanted_vehicle_id = %(wv)s::uuid AND status = 'active')
  AND NOT EXISTS (
    SELECT 1 FROM wanted_list_notification
    WHERE wanted_vehicle_id = %(wv)s::uuid AND camera_id = %(cam)s::uuid
      AND source IN ('camera_live', 'camera_lookback')
      AND created_at > now() - make_interval(mins => %(mins)s))
ON CONFLICT DO NOTHING
RETURNING notification_id;
"""

def record_live_alert(conn, wanted_vehicle_id, camera_id, sighting_id, plate, confidence, dedupe_minutes=10):
    with conn:  # one transaction: the advisory lock holds until commit
        params = {"wv": wanted_vehicle_id, "cam": camera_id, "sid": sighting_id,
                  "plate": plate, "conf": confidence, "mins": dedupe_minutes}
        cur = conn.cursor()
        cur.execute(LOCK_SQL, params)
        cur.execute(INSERT_SQL, params)
        return cur.fetchone() is not None

class WantedAlerter:
    def __init__(self, watcher, connect, record=record_live_alert):
        self._watcher, self._connect, self._record = watcher, connect, record
        self._alerts = 0
        self._last_error = None

    def handle(self, camera_id, saved_plate_reads):
        created = 0
        for sighting_id, plate, confidence in saved_plate_reads:
            wanted_id = self._watcher.lookup(plate)
            if wanted_id is None:
                continue
            try:
                conn = self._connect()
                try:
                    if self._record(conn, wanted_id, camera_id, sighting_id, plate, confidence):
                        created += 1
                finally:
                    conn.close()
            except Exception as e:  # noqa: BLE001 -- an alert failure must not stop ingest
                self._last_error = f"alert failed: {e}"
        self._alerts += created
        return created

    def status(self):
        return {"alerts_created": self._alerts, "last_error": self._last_error, **self._watcher.status()}
```
The lock and the insert run as two statements in one transaction (`with conn:`), so the lock is held until the insert commits.

Wiring: both cycles get `wanted_alerter=None`; after a successful `run_pipeline`, `if wanted_alerter is not None and result.saved_plate_reads: wanted_alerter.handle(camera.camera_id, result.saved_plate_reads)`. Cycle tests: a fake alerter receives exactly the pipeline's `saved_plate_reads`. `main.py`: build `WantedPlateWatcher(load_active=lambda: load_active_from_db(_connect), listen_connect=_connect)` and `WantedAlerter(watcher, _connect)` in `_lifespan` (where `_connect` reuses vehicle-detection's `_load_database_url` + `_connect_preferring_ipv4`), `watcher.start()`, pass `wanted_alerter` to both loops, `watcher.stop()` on shutdown, `/health` adds `"wanted_alerts": alerter.status()`. Env `VEHICLE_INGEST_WANTED_ALERTS=0` disables.

- [ ] **Step 5: Run** full vehicle-ingest suite → all pass.
- [ ] **Step 6: Commit** — `git commit -m "feat(vehicle-ingest): deduplicated live wanted-plate alerts"`

---

### Task 7: Frontend — Wanted List admin page

**Files:** Modify `frontend/src/api/wantedList.ts`, `frontend/src/types/api.ts`, `frontend/src/App.tsx`, `frontend/src/components/layout/nav-config.ts`; Create `frontend/src/pages/wanted-list/WantedListPage.tsx`

**Interfaces:**
- Consumes: Task 2 HTTP API.
- Produces: `listWanted(status)`, `createWanted({ plateNumber, personName, crimeDetails })`, `resolveWanted(id)`; route `/wanted-list` (admin); nav item "Wanted List" (`ShieldAlert` icon, admin).

- [ ] **Step 1: API + types** — `WantedVehicle` already exists in `types/api.ts`; add `listWanted`, `createWanted`, `resolveWanted` to `api/wantedList.ts` (GET/POST via `apiClient`).
- [ ] **Step 2: Page** — tabs Active / Resolved; an "Add wanted vehicle" form (plate in mono uppercase, person name, crime details; shows the 409 message inline; on success shows "Added — N earlier sightings found" when the look-back created alerts, otherwise "Added — cameras will alert when this plate is read"); table of entries with plate, person, crime, added time, and a "Mark resolved" button behind a confirm dialog. Uses TanStack Query with invalidation of `['wanted-list']` and `['notifications']`.
- [ ] **Step 3: Route + nav** — `ProtectedRoute allowedRoles={['admin']}`.
- [ ] **Step 4: Verify** — `npx tsc -b` clean; `npx oxlint src/pages/wanted-list` no new warnings.
- [ ] **Step 5: Commit** — `git commit -m "feat(frontend): admin wanted list page"`


---

### Task 8: Frontend — camera alerts in the bell

**Files:** Modify `frontend/src/types/api.ts` (`WantedListNotification`), `frontend/src/components/layout/NotificationBell.tsx`

- [ ] **Step 1: Types** — `source: 'manual_search' | 'camera_live' | 'camera_lookback'`; add `cameraId`, `cameraName`, `seenAt`, `plateConfidence` (all nullable).
- [ ] **Step 2: Render** — title "Camera spotted wanted plate — {plate}" for camera sources; second line person · crime; third line "{cameraName} · seen {relative seenAt} · read {pct}% confident"; a small "Possible match — verify before acting" line; look-back adds "seen before it was added to the list". `manual_search` rendering unchanged.
- [ ] **Step 3: Verify** — `npx tsc -b` clean.
- [ ] **Step 4: Commit** — `git commit -m "feat(frontend): show camera wanted-plate alerts in the bell"`

---

### Task 9: End-to-end verification against the live system

Requires user approval for test rows (tagged, deleted afterwards) and a temporary admin test user (deleted afterwards; its login audit rows remain, as before).

- [ ] **Step 1: Before baseline** — record responses of `GET /notifications`, `GET /notifications/unread-count`, `GET /wanted-list/check-plate`, vehicle-ingest `/health` from the currently running services.
- [ ] **Step 2: Restart** model1-service, vehicle-ingest with the new code; confirm `/health` shows `wanted_alerts.plates` equal to the active wanted count.
- [ ] **Step 3: Look-back** — insert two tagged sightings for plate `GJ01LB<rand>` at two cameras (5h and 1h ago); `POST /wanted-list` with that plate → `lookbackAlerts: 2`; `GET /notifications` shows two `camera_lookback` rows with camera names.
- [ ] **Step 4: Instant push** — `POST /wanted-list` plate `GJ01LV<rand>`; within 3s ingest `/health` plate count increases (proves NOTIFY, refresh is 60s).
- [ ] **Step 5: Live alert** — drive the real ingest `WantedAlerter` (same process path) with a saved tagged sighting for that plate → one `camera_live` notification; repeat immediately → still one; a second camera → two.
- [ ] **Step 6: Resolve** — `POST /wanted-list/:id/resolve`; within 3s the plate count drops; another read → no new notification.
- [ ] **Step 7: Validation** — duplicate active add → 409; non-admin (field_officer) `POST /wanted-list` → 403; garbage id → 400.
- [ ] **Step 8: Browser (Playwright, both themes, phone width)** — admin adds and resolves on the Wanted List page; the bell shows camera alerts with camera, time, confidence and the verify label; no console errors.
- [ ] **Step 9: Regression** — every Step 1 request again; existing fields unchanged; `manual_search` check-plate still creates its notification; all suites green.
- [ ] **Step 10: Cleanup** — delete tagged sightings, test wanted rows (their notifications cascade), test user; confirm counts match the Step 1 baseline.
