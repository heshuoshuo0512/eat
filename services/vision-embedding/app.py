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
MAX_IMAGE_BYTES = 5 * 1024 * 1024

app = FastAPI(title="Smart Canteen Vision Embedding", version="1.0.0")
_lock = threading.Lock()
_model = None
_processor = None


class ImageInput(BaseModel):
    contentType: str
    dataBase64: str


class EmbedRequest(BaseModel):
    model: str | None = None
    image: ImageInput


def model_bundle():
    global _model, _processor
    if _model is None:
        with _lock:
            if _model is None:
                _processor = AutoProcessor.from_pretrained(MODEL_NAME)
                _model = AutoModel.from_pretrained(MODEL_NAME)
                _model.eval()
    return _model, _processor


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME, "loaded": _model is not None}


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

    model, processor = model_bundle()
    inputs = processor(images=image, return_tensors="pt")
    with torch.inference_mode():
        vector = model.get_image_features(**inputs)[0]
        vector = vector / vector.norm(p=2).clamp(min=1e-12)
    embedding = vector.cpu().float().tolist()
    return {"model": MODEL_NAME, "dimension": len(embedding), "embedding": embedding}
