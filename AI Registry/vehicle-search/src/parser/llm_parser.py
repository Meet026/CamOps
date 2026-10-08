"""
LLM-based Query Parser Adapter.

Integrates optional external LLM providers (Gemini, OpenAI, Ollama) for parsing
complex, multi-clause natural language vehicle search prompts into structured query filters.
"""

import json
import logging
from typing import Optional
import urllib.request
import urllib.error

from ..config import settings
from ..schemas.search import ParsedQuery, DateRangeFilter

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """
You are an expert vehicle query parser for a police surveillance system.
Extract structured search fields from the user's natural language input into JSON.

Respond ONLY with valid JSON containing:
{
  "color": string or null (e.g., "white", "black", "red"),
  "vehicle_type": string or null (e.g., "car", "suv", "hatchback", "sedan", "motorcycle", "scooter", "truck", "auto_rickshaw"),
  "make": string or null (e.g., "maruti", "mahindra", "toyota", "hyundai", "tata"),
  "model": string or null (e.g., "wagon r", "scorpio", "fortuner", "swift", "creta"),
  "plate_pattern": string or null (e.g., "GJ01AB1234", "GJ01", "1234"),
  "location_text": string or null (e.g., "Vaishnodevi Circle", "SG Highway"),
  "hours_ago": integer or null (e.g., 2 for "last 2 hours")
}
"""

def parse_query_llm(text: str) -> Optional[ParsedQuery]:
    """Attempts LLM parsing if configured. Returns None if provider is disabled or fails."""
    if not settings.LLM_PROVIDER or settings.LLM_PROVIDER.lower() == "none":
        return None

    api_key = settings.LLM_API_KEY
    if not api_key and settings.LLM_PROVIDER in ["openai", "gemini"]:
        logger.debug("LLM provider enabled but no API key configured. Falling back to rule parser.")
        return None

    try:
        if settings.LLM_PROVIDER == "gemini":
            return _call_gemini(text, api_key)
        elif settings.LLM_PROVIDER == "openai":
            return _call_openai(text, api_key)
    except Exception as e:
        logger.warning(f"LLM parsing failed ({e}). Falling back to rule-based parser.")
        return None

    return None


def _call_gemini(text: str, api_key: str) -> Optional[ParsedQuery]:
    """Call Google Gemini REST API."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.LLM_MODEL}:generateContent?key={api_key}"
    payload = {
        "contents": [{
            "parts": [
                {"text": SYSTEM_PROMPT},
                {"text": f"User query: {text}"}
            ]
        }],
        "generationConfig": {"response_mime_type": "application/json"}
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req, timeout=5) as response:
        res_data = json.loads(response.read().decode('utf-8'))
        content = res_data['candidates'][0]['content']['parts'][0]['text']
        parsed_json = json.loads(content)
        return _json_to_parsed_query(text, parsed_json)


def _call_openai(text: str, api_key: str) -> Optional[ParsedQuery]:
    """Call OpenAI REST API."""
    url = "https://api.openai.com/v1/chat/completions"
    payload = {
        "model": settings.LLM_MODEL or "gpt-4o-mini",
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text}
        ]
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}'
        }
    )
    with urllib.request.urlopen(req, timeout=5) as response:
        res_data = json.loads(response.read().decode('utf-8'))
        content = res_data['choices'][0]['message']['content']
        parsed_json = json.loads(content)
        return _json_to_parsed_query(text, parsed_json)


def _json_to_parsed_query(raw_query: str, data: dict) -> ParsedQuery:
    from datetime import datetime, timedelta, timezone

    hours_ago = data.get("hours_ago")
    time_range = None
    if hours_ago:
        now = datetime.now(timezone.utc)
        time_range = DateRangeFilter(start_time=now - timedelta(hours=int(hours_ago)), end_time=now)

    return ParsedQuery(
        raw_query=raw_query,
        color=data.get("color"),
        vehicle_type=data.get("vehicle_type"),
        make=data.get("make"),
        model=data.get("model"),
        plate_pattern=data.get("plate_pattern"),
        location_text=data.get("location_text"),
        time_range=time_range,
        confidence=0.95
    )
