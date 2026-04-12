"""
One-time script to embed all existing entries that don't have embeddings.
Reusable for model swaps: clear all embeddings, then re-run.

Usage:
  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... EMBEDDING_SERVICE_URL=... \
  EMBED_API_KEY=... python backfill.py [--dry-run] [--batch-size 50]
"""
import argparse
import os
import sys

import requests
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
EMBED_URL = os.environ["EMBEDDING_SERVICE_URL"]
EMBED_KEY = os.environ.get("EMBED_API_KEY", "")


def main():
    parser = argparse.ArgumentParser(description="Backfill entry embeddings")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without writing")
    parser.add_argument("--batch-size", type=int, default=50, help="Entries per embedding batch")
    args = parser.parse_args()

    db = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Fetch entries without embeddings
    result = db.table("entries").select("id, path, content").is_("embedding", "null").execute()
    entries = result.data or []
    print(f"Found {len(entries)} entries without embeddings")

    if args.dry_run:
        for e in entries:
            print(f"  Would embed: {e['path']} ({len(e['content'])} chars)")
        return

    # Process in batches
    for i in range(0, len(entries), args.batch_size):
        batch = entries[i : i + args.batch_size]
        texts = [f"{e['path']}\n\n{e['content']}" for e in batch]

        resp = requests.post(
            f"{EMBED_URL}/embed",
            json={"texts": texts, "type": "search_document"},
            headers={"Authorization": f"Bearer {EMBED_KEY}"},
            timeout=30,
        )
        resp.raise_for_status()
        embeddings = resp.json()["embeddings"]

        for entry, embedding in zip(batch, embeddings):
            db.table("entries").update({"embedding": embedding}).eq("id", entry["id"]).execute()
            print(f"  Embedded: {entry['path']}")

        print(f"Batch {i // args.batch_size + 1}: {len(batch)} entries embedded")

    print("Done!")


if __name__ == "__main__":
    main()
