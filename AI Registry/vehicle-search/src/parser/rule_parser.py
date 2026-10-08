"""
Rule-based Natural Language Query Parser.

Acts as a high-speed, zero-dependency, offline parser for vehicle search queries.
Extracts:
- Colors (white, black, red, silver, blue, etc.)
- Vehicle Types (car, suv, sedan, hatchback, bike, scooter, truck, auto)
- Makes & Models (Wagon R, Swift, Scorpio, Fortuner, Creta, etc.)
- Plate numbers / partial registration regexes (GJ-01, GJ01AB1234, etc.)
- Spatial / Location mentions (Vaishnodevi circle, SG Highway, etc.)
- Temporal expressions (last 2 hours, yesterday, morning, etc.)
"""

import re
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Optional
from ..schemas.search import ParsedQuery, DateRangeFilter

# --- Dictionaries & Gazetteers ---

COLORS = {
    "white": ["white", "safed", "pearl white", "off-white"],
    "black": ["black", "kala", "dark black"],
    "red": ["red", "laal", "maroon", "crimson"],
    "silver": ["silver", "grey", "gray", "silver grey", "slver"],
    "blue": ["blue", "neela", "navy", "dark blue", "sky blue"],
    "yellow": ["yellow", "peela", "gold", "golden"],
    "green": ["green", "hara", "dark green"],
    "brown": ["brown", "bronze", "copper"]
}

VEHICLE_TYPES = {
    "car": ["car", "gadi", "four wheeler", "auto mobile", "passenger car"],
    "suv": ["suv", "sports utility", "muv"],
    "hatchback": ["hatchback"],
    "sedan": ["sedan"],
    "motorcycle": ["motorcycle", "bike", "two wheeler", "bullet", "splendor"],
    "scooter": ["scooter", "activa", "jupiter"],
    "auto_rickshaw": ["auto", "rickshaw", "auto rickshaw", "tuk tuk"],
    "truck": ["truck", "lorry", "container", "dumper"],
    "bus": ["bus", "travels"]
}

# Popular Indian vehicle models mapped to make + type
MODEL_GAZETTEER = {
    "wagon r": {"make": "maruti", "model": "wagon r", "type": "hatchback"},
    "wagonr": {"make": "maruti", "model": "wagon r", "type": "hatchback"},
    "swift": {"make": "maruti", "model": "swift", "type": "hatchback"},
    "dzire": {"make": "maruti", "model": "swift dzire", "type": "sedan"},
    "baleno": {"make": "maruti", "model": "baleno", "type": "hatchback"},
    "alto": {"make": "maruti", "model": "alto", "type": "hatchback"},
    "ertiga": {"make": "maruti", "model": "ertiga", "type": "suv"},
    "brezza": {"make": "maruti", "model": "vitara brezza", "type": "suv"},
    "scorpio": {"make": "mahindra", "model": "scorpio", "type": "suv"},
    "thar": {"make": "mahindra", "model": "thar", "type": "suv"},
    "xuv700": {"make": "mahindra", "model": "xuv700", "type": "suv"},
    "bolero": {"make": "mahindra", "model": "bolero", "type": "suv"},
    "fortuner": {"make": "toyota", "model": "fortuner", "type": "suv"},
    "innova": {"make": "toyota", "model": "innova", "type": "suv"},
    "creta": {"make": "hyundai", "model": "creta", "type": "suv"},
    "i20": {"make": "hyundai", "model": "i20", "type": "hatchback"},
    "verna": {"make": "hyundai", "model": "verna", "type": "sedan"},
    "nexon": {"make": "tata", "model": "nexon", "type": "suv"},
    "punch": {"make": "tata", "model": "punch", "type": "suv"},
    "harrier": {"make": "tata", "model": "harrier", "type": "suv"},
    "activa": {"make": "honda", "model": "activa", "type": "scooter"}
}

# Known location landmarks / roads in Gujarat / Ahmedabad
KNOWN_LANDMARKS = [
    "vaishnodevi circle", "vaishno devi circle", "vaishnodevi", "s g highway", "sg highway",
    "science city", "iskcon circle", "iskcon", "prahlad nagar", "bopal", "satellite",
    "gitanjali", "shivranjani", "c g road", "cg road", "paldi", "ashram road", "kalupur",
    "drive in road", "thaltej", "sarkhej", "naroda", "odhav", "sg road"
]


def parse_query_rules(text: str) -> ParsedQuery:
    """Parses a natural language vehicle search prompt using rule matching."""
    text_lower = text.lower()
    
    # 1. Color extraction
    color = None
    for c_key, synonyms in COLORS.items():
        if any(syn in text_lower for syn in synonyms):
            color = c_key
            break

    # 2. Make & Model extraction
    make = None
    model = None
    detected_type = None

    for m_key, info in MODEL_GAZETTEER.items():
        if m_key in text_lower:
            make = info["make"]
            model = info["model"]
            detected_type = info["type"]
            break

    # 3. Vehicle Type extraction (if not already matched by model)
    if not detected_type:
        for t_key, synonyms in VEHICLE_TYPES.items():
            if any(syn in text_lower for syn in synonyms):
                detected_type = t_key
                break

    # 4. License Plate pattern matching (e.g. GJ01AB1234, GJ-01, 1234)
    plate_pattern = None
    full_plate_match = re.search(r'\b[a-zA-Z]{2}[-\s]?\d{1,2}[-\s]?[a-zA-Z]{1,3}[-\s]?\d{4}\b', text)
    partial_plate_match = re.search(r'\b(gj|dl|mh|rj|mp)[-\s]?\d{1,2}\b', text, re.IGNORECASE)
    digit_match = re.search(r'\b\d{4}\b', text)

    if full_plate_match:
        plate_pattern = full_plate_match.group(0).upper().replace(" ", "").replace("-", "")
    elif partial_plate_match:
        plate_pattern = partial_plate_match.group(0).upper()
    elif digit_match:
        plate_pattern = digit_match.group(0)

    # 5. Location landmark extraction
    location_text = None
    for landmark in KNOWN_LANDMARKS:
        if landmark in text_lower:
            location_text = landmark.title()
            break

    # 6. Temporal parsing
    time_range = parse_time_range(text_lower)

    return ParsedQuery(
        raw_query=text,
        color=color,
        vehicle_type=detected_type,
        make=make,
        model=model,
        plate_pattern=plate_pattern,
        location_text=location_text,
        time_range=time_range,
        confidence=0.85 if (color or detected_type or model or location_text) else 0.4
    )


def parse_time_range(text: str) -> Optional[DateRangeFilter]:
    """Parses temporal expressions into UTC datetime ranges."""
    now = datetime.now(timezone.utc)
    
    # "last X hours/mins/days"
    match_hours = re.search(r'last\s+(\d+)\s+hour', text)
    match_mins = re.search(r'last\s+(\d+)\s+min', text)
    match_days = re.search(r'last\s+(\d+)\s+day', text)

    if match_hours:
        hours = int(match_hours.group(1))
        return DateRangeFilter(start_time=now - timedelta(hours=hours), end_time=now)
    elif match_mins:
        mins = int(match_mins.group(1))
        return DateRangeFilter(start_time=now - timedelta(minutes=mins), end_time=now)
    elif match_days:
        days = int(match_days.group(1))
        return DateRangeFilter(start_time=now - timedelta(days=days), end_time=now)

    if "today" in text:
        start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return DateRangeFilter(start_time=start_of_day, end_time=now)
    elif "yesterday" in text:
        start_of_yesterday = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_yesterday = start_of_yesterday + timedelta(hours=23, minutes=59, seconds=59)
        return DateRangeFilter(start_time=start_of_yesterday, end_time=end_of_yesterday)

    # Default to last 24 hours if vague time words present ("recent", "lately", "seen near")
    if any(w in text for w in ["seen", "last seen", "recently", "today"]):
        return DateRangeFilter(start_time=now - timedelta(hours=24), end_time=now)

    return None
