"""
Camera Location Resolver.

Maps natural language spatial references (e.g. "Vaishnodevi Circle", "SG Highway", "Science City")
to lists of specific camera IDs installed at or near those locations.

Uses:
1. SQL fuzzy search on `camera.name` and `camera.location`
2. Static gazetteer for key city landmarks (Ahmedabad / Gujarat police domain context)
"""

import logging
from typing import List, Optional, Dict
from ..database.connection import get_db_connection

logger = logging.getLogger(__name__)

# Pre-mapped landmark aliases for Ahmedabad / Gujarat police deployments
# Pre-mapped landmark aliases for Ahmedabad / Gujarat police deployments
LANDMARK_ALIAS_MAP: Dict[str, List[str]] = {
    "vaishnodevi circle": ["Visat", "Adalaj", "Chandkheda"],
    "vaishnodevi": ["Visat", "Adalaj", "Chandkheda"],
    "sg highway": ["Visat", "Adalaj", "Chiman", "CN Vidhyalaya"],
    "s g highway": ["Visat", "Adalaj", "Chiman", "CN Vidhyalaya"],
    "visat": ["Visat"],
    "visat circle": ["Visat"],
    "adalaj": ["Adalaj"],
    "science city": ["Visat", "CN Vidhyalaya"],
    "iskcon": ["Paldi", "CN Vidhyalaya"],
    "satellite": ["CN Vidhyalaya", "Paldi"],
    "navrangpura": ["Navrangpura"],
    "paldi": ["Paldi"],
    "ashram road": ["Janpath", "Ashram"],
    "chandkheda": ["Chandkheda", "O.N.G.C."],
    "rajkot": ["Rajkot"],
    "junagadh": ["Junagadh", "Dolatpara", "Timbavadi"],
    "gandhidham": ["Gandhidham"],
    "bilimora": ["Bilimora"],
    "patan": ["Patan"],
    "dehgam": ["Dehgam"]
}


def resolve_location_to_cameras(location_text: Optional[str]) -> List[str]:
    """Given a natural language location text, returns matching camera IDs from the database."""
    if not location_text:
        return []

    text_clean = location_text.strip().lower()
    search_terms = {location_text.strip()}

    # Check local landmark gazetteer
    for landmark, camera_keywords in LANDMARK_ALIAS_MAP.items():
        if landmark in text_clean or text_clean in landmark:
            search_terms.update(camera_keywords)

    matched_ids = set()
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            # Match any search term against name, address_text, or camera_id
            for term in search_terms:
                cur.execute("""
                    SELECT camera_id::text FROM camera
                    WHERE name ILIKE %s OR address_text ILIKE %s OR camera_id::text ILIKE %s
                    LIMIT 20;
                """, (f"%{term}%", f"%{term}%", f"%{term}%"))
                for row in cur.fetchall():
                    matched_ids.add(row[0])
        conn.close()
    except Exception as e:
        logger.warning(f"Error querying camera table for location terms {search_terms}: {e}")

    return list(matched_ids)

