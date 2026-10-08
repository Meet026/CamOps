"""
Conversation / chat schemas for multi-turn vehicle search.

Each conversation retains the last structured SearchRequest so follow-up
queries like "Show the latest one" or "Where did it go after that?" can
resolve against prior context without re-parsing the entire history.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from .search import VehicleSearchRequest, VehicleSearchResponse, ParsedQuery


class ChatMessage(BaseModel):
    role: str = "user"  # "user" or "assistant"
    content: str = ""
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ChatRequest(BaseModel):
    conversation_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    message: str
    image: bytes | None = None  # optional attached photo
    last_query: ParsedQuery | None = None


class ChatContext(BaseModel):
    """Server-side conversation state — not sent to the LLM raw."""
    conversation_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    messages: list[ChatMessage] = []
    last_search_request: VehicleSearchRequest | None = None
    last_search_response: VehicleSearchResponse | None = None


class ChatResponse(BaseModel):
    conversation_id: str
    reply: str
    search_response: VehicleSearchResponse | None = None
