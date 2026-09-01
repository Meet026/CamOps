#!/usr/bin/env node
/**
 * One-off helper for registering hackathon-provided cameras into the
 * Model 1 camera registry.
 *
 * We're given a place name (not exact lat/long) and an RTSP URL per camera.
 * This script:
 *   1. Geocodes the place name via OpenStreetMap Nominatim (free, no API key)
 *      — or, if OSM has no record of the landmark (common for informal local
 *      names), accepts manually-supplied --lat/--lon instead.
 *   2. Inserts a Camera row with:
 *        - addressText  = the place name you gave (kept as the human-readable
 *                          source of truth, since geocoding an informal
 *                          landmark name is approximate)
 *        - locationGeo  = the geocoded point (PostGIS requires NOT NULL here)
 *        - streamPath   = the full RTSP URL (stored as-is; Model 1 never
 *                          opens this connection itself — see
 *                          HACKATHON_INGEST_SPEC.md at the repo root)
 *        - cameraType   = 'ip' (has a network stream)
 *        - dataConfidence = 'self_reported' (geocoded from a name, not a
 *                            precise on-site GPS reading)
 *   3. Never touches actual video — no RTSP connection is opened, no footage
 *      is fetched or stored. Only metadata.
 *
 * Usage:
 *   node scripts/add-hackathon-camera.js \
 *     --name "Chiman Bhai Bridge Cam" \
 *     --place "Chiman Bhai Bridge, Ahmedabad" \
 *     --rtsp "rtsp://live.corp8.cloud:8554/stream/3" \
 *     --dept HOME
 *
 * --dept must be one of the existing department codes (HOME, RTO, FCS,
 * MUNI, HEALTH) — run with --list-depts to see them.
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = val;
    }
  }
  return args;
}

async function geocode(place) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', place);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');

  const res = await fetch(url, {
    headers: {
      // Nominatim usage policy requires a descriptive User-Agent.
      'User-Agent': 'sentinel-model1-hackathon-camera-import/1.0 (internal tooling)',
    },
  });
  if (!res.ok) {
    throw new Error(`Nominatim request failed: ${res.status} ${res.statusText}`);
  }
  const results = await res.json();
  if (!results.length) {
    throw new Error(`No geocoding result found for "${place}". Try a more specific place name.`);
  }
  return {
    lat: parseFloat(results[0].lat),
    lon: parseFloat(results[0].lon),
    displayName: results[0].display_name,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args['list-depts']) {
    const depts = await prisma.department.findMany();
    console.log(depts.map((d) => `${d.code}\t${d.name}\t${d.departmentId}`).join('\n'));
    await prisma.$disconnect();
    return;
  }

  const { name, place, rtsp, dept } = args;
  if (!name || !place || !rtsp || !dept) {
    console.error(
      'Usage: node scripts/add-hackathon-camera.js --name "<camera name>" --place "<location name>" --rtsp "<rtsp url>" --dept <CODE>',
    );
    console.error('Run with --list-depts to see valid department codes.');
    process.exit(1);
  }

  const department = await prisma.department.findUnique({ where: { code: dept } });
  if (!department) {
    console.error(`No department with code "${dept}". Run --list-depts to see valid codes.`);
    process.exit(1);
  }

  let geo;
  if (args.lat && args.lon) {
    // Manual override — used when Nominatim has no record of the landmark
    // (common for informal local bridge/junction names in India).
    geo = { lat: parseFloat(args.lat), lon: parseFloat(args.lon), displayName: '(manually supplied)' };
    console.log(`Using manually supplied coordinates: (${geo.lat}, ${geo.lon})`);
  } else {
    console.log(`Geocoding "${place}" via Nominatim...`);
    geo = await geocode(place);
    console.log(`  -> resolved to (${geo.lat}, ${geo.lon}) — "${geo.displayName}"`);
  }

  // locationGeo is PostGIS GEOGRAPHY(POINT, 4326) — must go through
  // $queryRaw/$executeRaw, same pattern used by CameraRegistryService.
  const [camera] = await prisma.$queryRaw`
    INSERT INTO camera (
      department_id, name, location_geo, address_text,
      camera_type, stream_path, data_confidence
    )
    VALUES (
      ${department.departmentId}::uuid,
      ${name},
      ST_SetSRID(ST_MakePoint(${geo.lon}, ${geo.lat}), 4326)::geography,
      ${place},
      'ip',
      ${rtsp},
      'self_reported'
    )
    ON CONFLICT (department_id, name) DO UPDATE SET
      location_geo = EXCLUDED.location_geo,
      address_text = EXCLUDED.address_text,
      stream_path = EXCLUDED.stream_path,
      updated_at = now()
    RETURNING camera_id, name, address_text, stream_path;
  `;

  console.log('Inserted/updated camera:');
  console.log(camera);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Failed:', err.message);
  await prisma.$disconnect();
  process.exit(1);
});
