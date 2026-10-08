"""
Database connection helper — reuses the same IPv4-preference logic from
vehicle-detection's sighting_store.py (Neon's IPv6 can hang on some
networks).  Falls back to model1-service/.env for DATABASE_URL if not
set directly in this service's environment.
"""
import socket
import urllib.parse

import psycopg2

from src.config import get_database_url


def connect(database_url: str | None = None):
    """
    Return a psycopg2 connection with a reasonable timeout.
    Tries direct connection first, and if that fails tries IPv4 hostaddr fallback.
    """
    if database_url is None:
        database_url = get_database_url()

    timeout = 8
    # Try standard connection first with timeout
    try:
        conn = psycopg2.connect(database_url, connect_timeout=timeout)
        conn.autocommit = True
        return conn
    except Exception:
        pass

    # Fallback to IPv4 hostaddr if DNS/IPv6 issues occur
    try:
        parsed = urllib.parse.urlparse(database_url)
        hostname = parsed.hostname
        port = parsed.port or 5432
        ipv4_addr = socket.getaddrinfo(hostname, port, socket.AF_INET)[0][4][0]
        separator = "&" if parsed.query else "?"
        conn = psycopg2.connect(f"{database_url}{separator}hostaddr={ipv4_addr}", connect_timeout=timeout)
        conn.autocommit = True
        return conn
    except Exception as e:
        raise ConnectionError(f"Failed to connect to database: {e}") from e

# Alias for compatibility across modules
get_db_connection = connect

