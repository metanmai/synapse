"""Standalone tests for the embedding service. No external dependencies required."""
import pytest
from fastapi.testclient import TestClient

# Patch env before importing app
import os
os.environ["EMBED_API_KEY"] = "test-key"

from app import app

client = TestClient(app)
AUTH = {"Authorization": "Bearer test-key"}


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["model"] == "nomic-embed-text-v1.5"


def test_embed_single_text():
    resp = client.post("/embed", json={"texts": ["hello world"], "type": "search_query"}, headers=AUTH)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["embeddings"]) == 1
    assert len(body["embeddings"][0]) == 768


def test_embed_batch():
    resp = client.post(
        "/embed",
        json={"texts": ["first doc", "second doc", "third doc"], "type": "search_document"},
        headers=AUTH,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["embeddings"]) == 3
    for emb in body["embeddings"]:
        assert len(emb) == 768


def test_embed_query_vs_document_differ():
    """search_query and search_document prefixes produce different embeddings for the same text."""
    text = "authentication flow"
    resp_q = client.post("/embed", json={"texts": [text], "type": "search_query"}, headers=AUTH)
    resp_d = client.post("/embed", json={"texts": [text], "type": "search_document"}, headers=AUTH)
    vec_q = resp_q.json()["embeddings"][0]
    vec_d = resp_d.json()["embeddings"][0]
    assert vec_q != vec_d


def test_embed_empty_texts_rejected():
    resp = client.post("/embed", json={"texts": [], "type": "search_query"}, headers=AUTH)
    assert resp.status_code == 400


def test_embed_invalid_type_rejected():
    resp = client.post("/embed", json={"texts": ["hi"], "type": "invalid"}, headers=AUTH)
    assert resp.status_code == 400


def test_embed_no_auth_rejected():
    resp = client.post("/embed", json={"texts": ["hi"], "type": "search_query"})
    assert resp.status_code == 403


def test_embed_wrong_key_rejected():
    resp = client.post(
        "/embed",
        json={"texts": ["hi"], "type": "search_query"},
        headers={"Authorization": "Bearer wrong-key"},
    )
    assert resp.status_code == 401
