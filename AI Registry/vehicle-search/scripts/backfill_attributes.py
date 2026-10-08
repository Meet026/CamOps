"""
Backfill realistic vehicle attributes into vehicle_sighting table.

Enriches the 10,336 existing sightings with:
- vehicle_color (white, black, red, silver, blue, grey, yellow)
- vehicle_make (Maruti, Hyundai, Mahindra, Tata, Toyota, Honda, etc.)
- vehicle_model_name (Wagon R, Swift, Scorpio, Thar, Creta, Nexon, etc.)
- vehicle_type (hatchback, suv, sedan, motorcycle, scooter, truck, bus)
- matched_plate (GJ-01-XX-1234, etc.)
- attribute confidences (0.85 - 0.98)

Includes coherent multi-camera journey tracks for popular vehicles (e.g. White Wagon R,
Black Scorpio, Red Swift) so route reconstruction on the map shows realistic multi-camera paths.
"""
import random
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from src.database.connection import get_db_connection

CAR_MODELS = [
    {"make": "Maruti", "model": "Wagon R", "type": "hatchback", "colors": ["white", "silver", "grey", "blue"]},
    {"make": "Maruti", "model": "Swift", "type": "hatchback", "colors": ["red", "white", "silver", "blue"]},
    {"make": "Maruti", "model": "Baleno", "type": "hatchback", "colors": ["blue", "grey", "white", "silver"]},
    {"make": "Maruti", "model": "Vitara Brezza", "type": "suv", "colors": ["red", "white", "silver"]},
    {"make": "Hyundai", "model": "Creta", "type": "suv", "colors": ["white", "black", "silver", "red"]},
    {"make": "Hyundai", "model": "i20", "type": "hatchback", "colors": ["white", "red", "grey"]},
    {"make": "Hyundai", "model": "Verna", "type": "sedan", "colors": ["white", "black", "silver"]},
    {"make": "Mahindra", "model": "Scorpio", "type": "suv", "colors": ["black", "white", "silver"]},
    {"make": "Mahindra", "model": "Thar", "type": "suv", "colors": ["black", "red", "grey"]},
    {"make": "Tata", "model": "Nexon", "type": "suv", "colors": ["white", "blue", "red", "grey"]},
    {"make": "Tata", "model": "Punch", "type": "suv", "colors": ["white", "red", "blue"]},
    {"make": "Toyota", "model": "Fortuner", "type": "suv", "colors": ["white", "black", "silver"]},
    {"make": "Honda", "model": "City", "type": "sedan", "colors": ["white", "silver", "black"]}
]

BIKE_MODELS = [
    {"make": "Honda", "model": "Activa", "type": "scooter", "colors": ["white", "black", "grey", "blue"]},
    {"make": "Hero", "model": "Splendor", "type": "motorcycle", "colors": ["black", "blue", "red"]},
    {"make": "Bajaj", "model": "Pulsar", "type": "motorcycle", "colors": ["black", "blue", "red"]},
    {"make": "Royal Enfield", "model": "Classic 350", "type": "motorcycle", "colors": ["black", "silver", "red"]}
]

TRUCK_MODELS = [
    {"make": "Tata", "model": "LPT 1613", "type": "truck", "colors": ["yellow", "blue", "white"]},
    {"make": "Ashok Leyland", "model": "Ecomet", "type": "truck", "colors": ["white", "yellow", "blue"]}
]

BUS_MODELS = [
    {"make": "GSRTC", "model": "Express", "type": "bus", "colors": ["red", "silver", "white"]},
    {"make": "Tata", "model": "Starbus", "type": "bus", "colors": ["white", "yellow", "blue"]}
]

GUJARAT_RTO = ["01", "27", "18", "03", "12", "06", "05"]
LETTERS = ["AB", "CD", "EF", "GH", "JK", "LM", "NP", "RS", "TU", "VW", "XY"]


def generate_plate(rto="01"):
    return f"GJ-{rto}-{random.choice(LETTERS)}-{random.randint(1000, 9999)}"


def main():
    conn = get_db_connection()
    cur = conn.cursor()

    print("Fetching sightings to enrich...")
    cur.execute("SELECT vehicle_sighting_id, vehicle_class, camera_id, detected_at FROM vehicle_sighting ORDER BY detected_at DESC;")
    rows = cur.fetchall()
    total = len(rows)
    print(f"Total sightings found: {total}")

    # Fetch camera names and IDs
    cur.execute("SELECT camera_id::text, name, address_text FROM camera;")
    cameras = {r[0]: (r[1] or "", r[2] or "") for r in cur.fetchall()}

    # Group cameras by area
    sg_highway_cams = [cid for cid, (name, addr) in cameras.items() if any(k in name.lower() or k in addr.lower() for k in ["visat", "adalaj", "ongc", "chiman", "dehgam"])]
    ahmedabad_central_cams = [cid for cid, (name, addr) in cameras.items() if any(k in name.lower() or k in addr.lower() for k in ["cn vidhyalaya", "navrangpura", "paldi", "ashram", "prem darwaja"])]
    rajkot_cams = [cid for cid, (name, addr) in cameras.items() if "rajkot" in name.lower() or "rajkot" in addr.lower()]

    print(f"SG Highway cameras: {len(sg_highway_cams)}")
    print(f"Central Ahmedabad cameras: {len(ahmedabad_central_cams)}")
    print(f"Rajkot cameras: {len(rajkot_cams)}")

    # We will define a few dedicated vehicle tracks:
    # 1. White Wagon R route: GJ-01-WR-2024 moving along SG Highway / Vaishnodevi / Adalaj / Visat
    # 2. Black Scorpio route: GJ-03-SC-9090 moving across Rajkot
    # 3. Red Swift route: GJ-01-SW-5544 moving across Central Ahmedabad
    # 4. Black Thar route: GJ-01-TH-7007
    # 5. Blue Creta route: GJ-01-BC-3322
    tracks = [
        {"make": "Maruti", "model": "Wagon R", "type": "hatchback", "color": "white", "plate": "GJ-01-WR-2024", "cams": sg_highway_cams},
        {"make": "Mahindra", "model": "Scorpio", "type": "suv", "color": "black", "plate": "GJ-03-SC-9090", "cams": rajkot_cams},
        {"make": "Maruti", "model": "Swift", "type": "hatchback", "color": "red", "plate": "GJ-01-SW-5544", "cams": ahmedabad_central_cams},
        {"make": "Mahindra", "model": "Thar", "type": "suv", "color": "black", "plate": "GJ-01-TH-7007", "cams": sg_highway_cams},
        {"make": "Hyundai", "model": "Creta", "type": "suv", "color": "blue", "plate": "GJ-01-BC-3322", "cams": ahmedabad_central_cams},
        {"make": "Toyota", "model": "Fortuner", "type": "suv", "color": "white", "plate": "GJ-01-FT-8888", "cams": sg_highway_cams},
    ]

    # Pre-assign tracks to the most recent sightings at those cameras so queries for those specific vehicles find realistic multi-stop journeys!
    assigned_sightings = set()
    updates = []

    for track in tracks:
        # Find matching sightings for this track's cameras
        cam_set = set(track["cams"])
        matching_rows = [r for r in rows if str(r[2]) in cam_set and r[1] == "car" and r[0] not in assigned_sightings][:12]
        for r in matching_rows:
            assigned_sightings.add(r[0])
            updates.append((
                track["color"],
                track["type"],
                track["make"],
                track["model"],
                track["plate"],
                0.95, 0.94, 0.93, 0.96,
                r[0]
            ))

    # For the remaining sightings, assign realistic attributes based on vehicle_class
    rng = random.Random(42)
    for r in rows:
        if r[0] in assigned_sightings:
            continue

        vclass = (r[1] or "car").lower()
        if vclass == "car":
            choice = rng.choice(CAR_MODELS)
        elif vclass == "motorcycle":
            choice = rng.choice(BIKE_MODELS)
        elif vclass == "truck":
            choice = rng.choice(TRUCK_MODELS)
        elif vclass == "bus":
            choice = rng.choice(BUS_MODELS)
        else:
            choice = rng.choice(CAR_MODELS)

        color = rng.choice(choice["colors"])
        make = choice["make"]
        model = choice["model"]
        vtype = choice["type"]
        plate = generate_plate(rng.choice(GUJARAT_RTO))
        conf = round(rng.uniform(0.85, 0.98), 2)

        updates.append((
            color,
            vtype,
            make,
            model,
            plate,
            conf, conf, conf, conf,
            r[0]
        ))

    print(f"Prepared {len(updates)} updates. Executing fast bulk update in Postgres...", flush=True)
    import psycopg2.extras
    
    # We update using UPDATE vehicle_sighting AS s SET ... FROM (VALUES ...) AS v
    batch_size = 1000
    for i in range(0, len(updates), batch_size):
        batch = updates[i:i + batch_size]
        # format: (color, vtype, make, model, plate, c1, c2, c3, c4, sighting_id)
        psycopg2.extras.execute_values(
            cur,
            """
            UPDATE vehicle_sighting AS s
            SET vehicle_color = v.color,
                vehicle_type = v.vtype,
                vehicle_make = v.make,
                vehicle_model_name = v.model,
                matched_plate = v.plate,
                vehicle_color_confidence = v.c1::real,
                vehicle_type_confidence = v.c2::real,
                vehicle_make_confidence = v.c3::real,
                vehicle_model_confidence = v.c4::real,
                plate_confidence = 0.92
            FROM (VALUES %s) AS v(color, vtype, make, model, plate, c1, c2, c3, c4, sighting_id)
            WHERE s.vehicle_sighting_id = v.sighting_id::uuid;
            """,
            batch,
            page_size=1000
        )
        conn.commit()
        print(f"Updated {min(i + batch_size, len(updates))} / {len(updates)} records...", flush=True)

    print("Backfill completed successfully!", flush=True)

    # Verify distribution
    cur.execute("SELECT vehicle_color, count(*) FROM vehicle_sighting GROUP BY vehicle_color ORDER BY count(*) DESC LIMIT 10;")
    print("Color distribution:", cur.fetchall())

    cur.execute("SELECT vehicle_model_name, count(*) FROM vehicle_sighting GROUP BY vehicle_model_name ORDER BY count(*) DESC LIMIT 10;")
    print("Model distribution:", cur.fetchall())

    conn.close()


if __name__ == "__main__":
    main()
