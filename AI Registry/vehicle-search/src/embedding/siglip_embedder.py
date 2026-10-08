"""
SigLIP 2 Vision-Language Embedder.

Encodes natural language queries into 768-dim embeddings for vector similarity search.
Uses transformers / torch if installed and available, with graceful CPU fallback.
"""

import logging
from typing import List, Optional
import numpy as np

from ..config import settings

logger = logging.getLogger(__name__)

_siglip_model = None
_siglip_tokenizer = None
_initialized = False


def _init_siglip():
    """Lazy initialization of SigLIP 2 model."""
    global _siglip_model, _siglip_tokenizer, _initialized
    if _initialized:
        return

    _initialized = True
    if not settings.SIGLIP_ENABLED:
        logger.info("SigLIP embedding is disabled in configuration.")
        return

    try:
        import torch
        from transformers import AutoTokenizer, AutoModel

        logger.info(f"Loading SigLIP 2 model: {settings.SIGLIP_MODEL_NAME}")
        device = "cuda" if (settings.USE_CUDA and torch.cuda.is_available()) else "cpu"
        
        _siglip_tokenizer = AutoTokenizer.from_pretrained(settings.SIGLIP_MODEL_NAME)
        _siglip_model = AutoModel.from_pretrained(settings.SIGLIP_MODEL_NAME).to(device)
        _siglip_model.eval()
        logger.info(f"SigLIP 2 loaded successfully on {device}.")
    except Exception as e:
        logger.warning(f"Could not initialize SigLIP 2 embedder ({e}). Text vector search will be disabled.")


def embed_text(text: str) -> Optional[List[float]]:
    """Encodes text query into a normalized embedding vector."""
    if not text or not text.strip():
        return None

    _init_siglip()

    if _siglip_model is None or _siglip_tokenizer is None:
        return None

    try:
        import torch
        device = next(_siglip_model.parameters()).device
        inputs = _siglip_tokenizer([text], padding=True, return_tensors="pt").to(device)

        with torch.no_grad():
            if hasattr(_siglip_model, "get_text_features"):
                text_features = _siglip_model.get_text_features(**inputs)
            else:
                text_features = _siglip_model(**inputs).last_hidden_state[:, 0, :]

            # L2 normalize
            text_features = text_features / text_features.norm(p=2, dim=-1, keepdim=True)
            embedding = text_features[0].cpu().numpy().tolist()
            return embedding
    except Exception as e:
        logger.warning(f"Failed to encode text query with SigLIP ({e}).")
        return None
