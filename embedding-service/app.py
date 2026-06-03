import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

model: SentenceTransformer | None = None

VALID_TYPES = {"search_document", "search_query"}
API_KEY = os.environ.get("EMBED_API_KEY", "")

security = HTTPBearer()


def verify_key(credentials: HTTPAuthorizationCredentials = Security(security)) -> None:
    if API_KEY and credentials.credentials != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    model = SentenceTransformer("nomic-ai/nomic-embed-text-v1.5", trust_remote_code=True)
    yield


app = FastAPI(lifespan=lifespan)


class EmbedRequest(BaseModel):
    texts: list[str]
    type: str = "search_document"


@app.get("/health")
def health():
    return {
        "status": "ok" if model is not None else "loading",
        "model": "nomic-embed-text-v1.5",
    }


@app.post("/embed")
def embed(req: EmbedRequest, _: None = Security(verify_key)):
    if req.type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"type must be one of {VALID_TYPES}")
    if not req.texts:
        raise HTTPException(status_code=400, detail="texts must be a non-empty list")
    if model is None:
        raise HTTPException(status_code=503, detail="Model is still loading")

    prefixed = [f"{req.type}: {t}" for t in req.texts]
    embeddings = model.encode(prefixed, normalize_embeddings=True)
    return {"embeddings": embeddings.tolist()}
