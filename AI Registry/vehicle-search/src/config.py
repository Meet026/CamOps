"""
Centralized configuration for the vehicle-search service.

Every tunable parameter is read from environment variables with sensible
defaults.  Nothing is hard-coded: model paths, thresholds, scoring
weights, provider names are all configurable — per the implementation
plan's Rule 10.
"""
import os

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
def get_database_url() -> str:
    """Return DATABASE_URL from env, falling back to model1-service/.env."""
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    env_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "model1-service", ".env",
    )
    env_path = os.path.normpath(env_path)
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("DATABASE_URL=") and not line.startswith("#"):
                    return line.split("=", 1)[1]
    
    # Check parent directory fallback
    fallback_path = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".env"))
    if os.path.exists(fallback_path):
        with open(fallback_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("DATABASE_URL=") and not line.startswith("#"):
                    return line.split("=", 1)[1]

    raise RuntimeError(f"No DATABASE_URL found in env or model1-service/.env")


class Settings:
    SERVICE_HOST: str = os.environ.get("SERVICE_HOST", "0.0.0.0")
    SERVICE_PORT: int = int(os.environ.get("SERVICE_PORT", "8300"))
    DEBUG: bool = os.environ.get("DEBUG", "true").lower() == "true"
    
    LLM_PROVIDER: str = os.environ.get("LLM_PROVIDER", "offline")
    LLM_MODEL: str = os.environ.get("LLM_MODEL", "gemini-2.0-flash")
    LLM_API_KEY: str | None = os.environ.get("LLM_API_KEY") or os.environ.get("GEMINI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    
    SIGLIP_ENABLED: bool = os.environ.get("SIGLIP_ENABLED", "false").lower() == "true"
    SIGLIP_MODEL_NAME: str = os.environ.get("SIGLIP_MODEL_NAME", "google/siglip-base-patch16-224")
    USE_CUDA: bool = os.environ.get("USE_CUDA", "true").lower() == "true"

settings = Settings()

