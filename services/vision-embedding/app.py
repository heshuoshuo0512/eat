import base64
import io
import os
import threading

import torch
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel
from transformers import AutoModel, AutoProcessor


MODEL_NAME = os.getenv("VISION_EMBEDDING_MODEL", "google/siglip-base-patch16-224")
MODEL_CHECKPOINT = os.getenv("VISION_EMBEDDING_CHECKPOINT", "").strip()


def portable_model_source(checkpoint):
    if not checkpoint or os.name != "nt" or not os.path.isabs(checkpoint):
        return checkpoint
    try:
        relative = os.path.relpath(checkpoint, os.getcwd())
    except ValueError:
        return checkpoint
    if not relative.startswith("..") and relative.isascii():
        return relative
    return checkpoint


MODEL_SOURCE = portable_model_source(MODEL_CHECKPOINT) or MODEL_NAME
MODEL_VERSION = os.getenv(
    "VISION_EMBEDDING_MODEL_VERSION",
    os.path.basename(os.path.dirname(MODEL_CHECKPOINT.rstrip("/\\"))) if MODEL_CHECKPOINT else MODEL_NAME,
)
MAX_IMAGE_BYTES = 5 * 1024 * 1024
EXPECTED_DIMENSION = 768
DEVICE = "cuda" if torch.cuda.is_available() and os.getenv("VISION_EMBEDDING_DEVICE", "auto") != "cpu" else "cpu"

app = FastAPI(title="Smart Canteen Vision Embedding", version="1.0.0")
_lock = threading.Lock()
_model = None
_processor = None
_load_error = None


class ImageInput(BaseModel):
    contentType: str
    dataBase64: str


class EmbedRequest(BaseModel):
    model: str | None = None
    image: ImageInput


def model_bundle():
    global _model, _processor, _load_error
    if _model is None:
        with _lock:
            if _model is None:
                try:
                    _processor = AutoProcessor.from_pretrained(MODEL_SOURCE)
                    _model = AutoModel.from_pretrained(MODEL_SOURCE).to(DEVICE)
                    _model.eval()
                    _load_error = None
                except Exception as exc:
                    _load_error = str(exc)
                    raise
    return _model, _processor


@app.get("/health")
def health():
    return {
        "ok": _load_error is None,
        "model": MODEL_NAME,
        "modelVersion": MODEL_VERSION,
        "checkpoint": MODEL_CHECKPOINT or None,
        "dimension": EXPECTED_DIMENSION,
        "device": DEVICE,
        "loaded": _model is not None,
        "error": _load_error,
    }


@app.post("/embed")
def embed(request: EmbedRequest):
    if request.image.contentType not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="unsupported image type")
    try:
        raw = base64.b64decode(request.image.dataBase64, validate=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid base64 image") from exc
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="image must be between 1 byte and 5MB")
    try:
        image = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid image") from exc

    try:
        model, processor = model_bundle()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"model checkpoint failed to load: {exc}") from exc
    inputs = processor(images=image, return_tensors="pt")
    with torch.inference_mode():
        vector = model.get_image_features(**{key: value.to(DEVICE) for key, value in inputs.items()})[0]
        vector = vector / vector.norm(p=2).clamp(min=1e-12)
    embedding = vector.cpu().float().tolist()
    if len(embedding) != EXPECTED_DIMENSION:
        raise HTTPException(status_code=503, detail=f"checkpoint dimension {len(embedding)} is not {EXPECTED_DIMENSION}")
    return {"model": MODEL_NAME, "modelVersion": MODEL_VERSION, "dimension": len(embedding), "embedding": embedding}
