# Setup and Run

Everything needed to take this project from a fresh `git clone` to a running
system, then start it again on later days.

- **First time?** Work through §1–§7 in order. Budget roughly an hour, most of
  it waiting on downloads.
- **Already set up?** Skip to **§8 Daily startup**.

There is no `docker-compose` or `Makefile` here — each service is started by
hand in its own terminal. Five processes total, though **the demo only needs
two of them** (see §7).

Every command below was run and verified on this machine on 2026-09-08.

---

## 1. What you are setting up

| # | Service | Port | Runtime | Required for the demo? |
|---|---|---|---|---|
| 1 | `model1-service` | 3000 | Node / NestJS | **Yes** — login, cameras, heatmap |
| 2 | `frontend` | 5173 | Vite / React | **Yes** — the UI |
| 3 | `vehicle-detection` | 8000 | Python / FastAPI | Only for the *real* photo search |
| 4 | `video-stream` | 8100 | Python / FastAPI | Only for the Live Stream pages |
| 5 | `vehicle-ingest` | 8200 | Python / FastAPI | No — background ingest |

The frontend hardcodes these ports in its `.env`, so do not change them
casually:

```
VITE_API_BASE_URL=http://localhost:3000/api/v1
VITE_VEHICLE_API_BASE_URL=http://localhost:8000
VITE_STREAM_API_BASE_URL=http://localhost:8100
```

The database is **hosted Neon Postgres** — there is no local database to
install or start, but you need network access and a connection string.

---

## 2. Prerequisites

Install these before anything else. Versions confirmed working on this machine:

| Tool | Version here | Needed by | Notes |
|---|---|---|---|
| Node | v24.15.0 | #1, #2 | No `engines` field is declared, so this is what is known-good, not a hard floor |
| Python | 3.12.3 | #3, #4, #5 | All three `pyproject.toml` files require **>= 3.12** |
| ffmpeg | 6.1.1 | #4 | Must be on `PATH` — video-stream shells out to it |
| psql | any | optional | Only for the database checks below |

Check all four:

```bash
node --version && python3 --version && ffmpeg -version | head -1 && psql --version
```

On Debian/Ubuntu, ffmpeg and psql come from:

```bash
sudo apt install ffmpeg postgresql-client
```

You will also need:

- **A Neon `DATABASE_URL`** for the shared Postgres instance.
- **RTSP gateway credentials** (an email + password) if you want live streams.
- **A Hugging Face account is *not* required** — the model downloads are public.

---

## 3. Environment files

Three `.env` files. Two have committed examples; one does not.

```bash
cd /path/to/PA
cp model1-service/.env.example model1-service/.env
cp frontend/.env.example       frontend/.env
```

### `frontend/.env`

Usually needs **no edits** — the example already points at the right localhost
ports.

### `model1-service/.env`

This one needs real secrets. The keys that actually matter to get running:

| Key | What to put |
|---|---|
| `DATABASE_URL` | Your Neon connection string (`postgresql://…?sslmode=require`) |
| `JWT_SECRET` | Any long random string |
| `REFRESH_TOKEN_SECRET` | A **different** long random string |
| `PORT` | `3000` |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173` |

Generate the two secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

The remaining keys (`OPENAI_*`, `CLOUDINARY_*`, the `HEALTH_*` tuning values,
`GIS_GAP_ANALYSIS_DEFAULT_GRID_SIZE`) already have sensible defaults in the
example and are only needed for the specific features that use them. The demo
does not touch them.

### `AI Registry/video-stream/.env`

**No example file exists for this one — create it by hand.** Only needed for
live streams:

```bash
cat > "AI Registry/video-stream/.env" <<'EOF'
VIDEO_STREAM_RTSP_EMAIL=your-account@example.com
VIDEO_STREAM_RTSP_PASSWORD=your-password
EOF
```

Without it the upstream RTSP gateway returns **401** and no stream will ever
play. `vehicle-detection` and `vehicle-ingest` need no `.env` of their own.

> **The Python services do not carry their own `DATABASE_URL`.** They read it
> out of `model1-service/.env` by relative path — see `_load_database_url()` in
> `vehicle-detection/src/sighting_store.py`, which resolves
> `../../../model1-service/.env`. Moving, renaming, or forgetting that file
> breaks all three Python services with `ENV_FILE_MISSING`.

---

## 4. Install dependencies

### Node projects

```bash
cd model1-service && npm install
cd ../frontend    && npm install
```

### Python services — one virtualenv each

```bash
cd "AI Registry/video-stream"
python3 -m venv .venv && .venv/bin/pip install -e .
```

Then the same two lines for `AI Registry/vehicle-ingest`.

**`vehicle-detection` needs special handling.** Do not let pip resolve
`ultralytics` freely — it was observed spending **11+ minutes** in dependency
resolution with zero disk growth. Install the pinned versions against the CPU
wheel index first:

```bash
cd "AI Registry/vehicle-detection"
python3 -m venv .venv
.venv/bin/pip install --extra-index-url https://download.pytorch.org/whl/cpu \
  "torch==2.13.0+cpu" "ultralytics==8.4.137"
.venv/bin/pip install -e .
```

---

## 5. Download the Re-ID model

**Skip this if you are only running the demo (services #1 and #2).** Required
for `vehicle-detection` and `vehicle-ingest`.

The model weights are ~345 MB each, **gitignored, and not tracked in git** — a
fresh clone does not have them, and `vehicle-detection` will fail to start
without them. Confirmed: `git ls-files "AI Registry/vehicle-reid/models/"`
returns nothing, and `AI Registry/vehicle-reid/.gitignore` ignores `models/`.

```bash
cd "AI Registry/vehicle-reid"
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/python scripts/fetch_model.py
```

This downloads two models from Hugging Face into `models/`:

| File | Size | What it is |
|---|---|---|
| `vehicle_vit_clip_reid.onnx` | ~345 MB | Base CLIP-ReID, VeRi-776-trained. **This is what the services use.** |
| `vehicle_vit_clip_reid_finetuned.onnx` + `.onnx.data` | ~345 MB | Fine-tuned variant. Both files required together. |

The script is idempotent, so re-running it is safe. No local training is
needed.

> **Do not mix the two models.** Embeddings from them are **not comparable** —
> measured directly, the same image embeds at only **0.4974** cosine similarity
> to *itself* across the two. If `vehicle-detection` and `vehicle-ingest` ever
> disagree about which to load, nothing errors: every query silently scores
> ~0.5 against everything and the route feature returns nothing, forever, for
> no visible reason. Both currently default to the **base** model.
>
> (Note: `fetch_model.py`'s own docstring says the fine-tuned model is the
> deployed default. That is now out of date — the running service reports the
> base model, after a deliberate switch back. Trust the `/health` output over
> the docstring.)

YOLO weights (`yolo11n.pt`) download automatically on first detector run.

---

## 6. Prepare the database

Two separate steps, because two different systems own parts of the schema.

### 6a. Model 1 tables (Prisma)

```bash
cd model1-service
npx prisma migrate deploy
npx prisma generate
```

`migrate deploy` applies the committed migrations without prompting — correct
for a shared database. The baseline migration also enables the `pgcrypto` and
`postgis` extensions.

### 6b. Vehicle sightings table + pgvector

**This is a separate script and easy to miss.** The `vehicle_sighting` table
and the `vector` extension are **not** in the Prisma schema or migrations —
they are created by a standalone script in the AI Registry:

```bash
cd "AI Registry/vehicle-detection"
.venv/bin/python scripts/setup_database.py
```

It runs `CREATE EXTENSION IF NOT EXISTS vector;` and creates
`vehicle_sighting`. It reads `DATABASE_URL` from `model1-service/.env`, so
finish §3 first. Idempotent.

### Verify

```bash
DBURL=$(grep -E "^DATABASE_URL" model1-service/.env | cut -d= -f2- | tr -d '"')
psql "$DBURL" -tAc "select extname from pg_extension order by extname;"
psql "$DBURL" -tAc "select count(*) from vehicle_sighting;"
```

Expect to see `pgcrypto`, `plpgsql`, `postgis`, and `vector` listed. On this
machine: postgis 3.6.0, vector 0.8.6.

### A login user

The app has a login wall and **no seed script**. On this database there is
exactly one user:

```
admin@sentinel.local   (role: admin)
```

Its password is **not stored anywhere in this repo**. If you are joining an
existing deployment, ask whoever set it up. If you are standing up a brand-new
database, you must insert a user yourself — the `app_user` table needs
`email`, a **bcrypt** `password_hash`, and a `role` from
`admin` / `field_officer` / `dept_viewer` / `auditor`.

Generate a hash with `bcrypt` (available in model1-service's `node_modules`):

```bash
cd model1-service
node -e "require('bcrypt').hash('YourPassword',10).then(console.log)"
```

Then insert it with `psql`. Treat this as a deliberate act: on a **shared**
database, do not overwrite an existing user's `password_hash` to get yourself
in — that locks out whoever owns it.

---

## 7. First start

Two terminals is enough for the demo.

**Terminal 1 — model1-service**

```bash
cd model1-service && npm run start:dev
```

Wait for Nest to finish mapping routes, then:

```bash
curl -s http://localhost:3000/livez
# {"status":"ok","database":"ok","timestamp":"..."}
```

> **The health path is `/livez`, not `/health`, and it is NOT under the API
> prefix.** `main.ts` sets a global prefix of `api/v1` but explicitly excludes
> `livez`. So `/livez` returns 200 while `/api/v1/livez` and `/api/v1/health`
> both **404**. That 404 is the wrong URL, not a broken service.
>
> `"database":"ok"` is the real signal — it means Neon is reachable. If that
> field says anything else, fix it before continuing; everything downstream
> depends on it.

**Terminal 2 — frontend**

```bash
cd frontend && npm run dev
```

Open **http://localhost:5173** and log in.

That is the whole demo stack. The heatmap is served by model1-service; the
route flow and the watchlist alerts are generated in the browser and call no
backend at all (see `DEMO_CHANGES.md`).

### The optional three

**vehicle-detection (8000)** — real photo search. Slow to start; it loads YOLO
plus a 345 MB ONNX model.

```bash
cd "AI Registry/vehicle-detection"
.venv/bin/uvicorn src.api:app --reload --port 8000
curl -s http://localhost:8000/health
```

Check `embedder_model_path` in that response against the §5 warning.

**video-stream (8100)** — Live Stream pages. Needs ffmpeg and its `.env`.

```bash
cd "AI Registry/video-stream"
.venv/bin/uvicorn src.api:app --reload --port 8100
curl -s http://localhost:8100/health     # {"status":"ok"}
```

**vehicle-ingest (8200)** — background frame ingest. Nothing user-facing needs
it. Scope it to a few cameras:

```bash
cd "AI Registry/vehicle-ingest"
VEHICLE_INGEST_CAMERA_IDS=cam07,cam22,cam24 \
  .venv/bin/uvicorn src.main:app --port 8200
```

> **Known issue — this service's `/health` can hang.** Verified here: the
> process had been up 3 days at ~14.5% CPU with port 8200 listening, and
> `curl` returned nothing even at a 15-second timeout.
>
> `_camera_cycle_loop` iterates every camera **synchronously inside the async
> loop**, so while a cycle runs the event loop cannot answer HTTP. More cameras
> makes it worse, not better — widening the allowlist made cycles *longer*. A
> hanging `/health` here usually means mid-cycle, not dead. Keep the allowlist
> small.

---

## 8. Daily startup

Once set up, this is all you need.

```bash
# the two the demo needs
cd model1-service && npm run start:dev     # :3000
cd frontend       && npm run dev           # :5173

# optional
cd "AI Registry/vehicle-detection" && .venv/bin/uvicorn src.api:app  --reload --port 8000
cd "AI Registry/video-stream"      && .venv/bin/uvicorn src.api:app  --reload --port 8100
cd "AI Registry/vehicle-ingest"    && .venv/bin/uvicorn src.main:app --port 8200
```

Health check everything at once:

```bash
for u in http://localhost:3000/livez \
         http://localhost:8000/health \
         http://localhost:8100/health \
         http://localhost:8200/health \
         http://localhost:5173/ ; do
  printf '%s  %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$u")" "$u"
done
```

`200` on each is good. `000` means no response inside the timeout — for 8200,
see the note above.

See what is listening:

```bash
ss -ltnp | grep -E ':(3000|5173|8000|8100|8200)'
```

**Shutting down:** `Ctrl+C` in each terminal. To clear a stuck port, find the
PID from the `ss` command above and `kill <pid>`. Prefer a specific PID over
`pkill -f uvicorn` — all three Python services run under uvicorn, so a broad
pattern takes down more than you meant.

---

## 9. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `404` on `/api/v1/health` | Wrong URL. Use `/livez` (§7). |
| `/livez` shows `database` not ok | Bad or unreachable `DATABASE_URL` in `model1-service/.env`. |
| Python service: `ENV_FILE_MISSING` | `model1-service/.env` is missing or moved — the Python services read it by relative path (§3). |
| Python service: `DATABASE_URL_NOT_FOUND` | The file exists but has no uncommented `DATABASE_URL=` line. |
| vehicle-detection won't start, model error | Model files absent. Run `fetch_model.py` (§5). |
| `relation "vehicle_sighting" does not exist` | Skipped §6b. Run `setup_database.py`. |
| `type "vector" does not exist` | Same — §6b enables the extension. |
| Photo search returns nothing, ever, no error | Model mismatch between services. Compare `embedder_model_path` (§5). |
| Streams never play, gateway `401` | Missing or wrong `AI Registry/video-stream/.env` (§3). |
| Streams fail, no ffmpeg errors | `ffmpeg` not on `PATH` (§2). |
| `curl` to 8200 hangs | Expected mid-cycle. See §7. |
| pip hangs installing `ultralytics` | Use the pinned CPU-index install (§4). |
| Frontend loads, all API calls fail | model1-service not running, or `frontend/.env` points at the wrong port. |
| Can't log in | See §6 — the password is not in this repo. |

---

## 10. Related documents

| File | Contents |
|---|---|
| `DEMO_CHANGES.md` | What in the demo is real vs. scripted — **read before presenting** |
| `PROJECT_IMPLEMENTATION_OVERVIEW.md` | Architecture overview |
| `SENTINEL_IDEA_AND_ROADMAP.md` | Product direction |
| `AI Registry/docs/VEHICLE_REID_FINDINGS_AND_DECISIONS.md` | Measured Re-ID results and their limits |
| `AI Registry/vehicle-reid/README.md` | Model fetching and fine-tuning |
