"""
Parser Resolver.

Unifies LLM and rule-based query parsers.
Tries LLM parsing first (if enabled and configured); if LLM is unavailable or fails,
transparently falls back to the high-speed rule-based parser.
"""

from typing import Optional
from .rule_parser import parse_query_rules
from .llm_parser import parse_query_llm
from ..schemas.search import ParsedQuery


def parse_query(text: str) -> ParsedQuery:
    """Parses a user's natural language vehicle search query into structured search intent."""
    if not text or not text.strip():
        return ParsedQuery(raw_query="")

    # Try LLM first if available
    llm_result = parse_query_llm(text)
    if llm_result:
        return llm_result

    # Default to robust rule-based parser
    return parse_query_rules(text)
