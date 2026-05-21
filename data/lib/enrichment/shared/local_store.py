"""SQLite-backed enrichment cache + failure log.

Drop-in replacement for the Supabase HTTP CacheClient. Same `lookup` / `write`
signatures so enrich_wines.py only needs to swap the constructor.

The cache keeps a supersede chain: writing a new row for a SKU marks any
existing active row as superseded (audit trail preserved).
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any


class LocalCache:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def lookup(self, sku: str, prompt_hash: str, evidence_hash: str) -> dict[str, Any] | None:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT id, sku, category, prompt_hash, evidence_hash, response_json, "
                "model, tokens_in, tokens_out, cost_thb, confidence, "
                "validation_status, validation_issues "
                "FROM enrichment_cache "
                "WHERE sku=? AND prompt_hash=? AND evidence_hash=? AND superseded_at IS NULL "
                "LIMIT 1",
                (sku, prompt_hash, evidence_hash),
            ).fetchone()
            if row is None:
                return None
            out = dict(row)
        finally:
            conn.close()
        out["response_json"] = json.loads(out["response_json"]) if out["response_json"] else {}
        out["validation_issues"] = json.loads(out["validation_issues"] or "[]")
        return out

    def write(
        self,
        sku: str,
        category: str,
        prompt_hash: str,
        evidence_hash: str,
        prompt_text: str,
        response_json: dict,
        response_raw: str,
        model: str,
        tokens_in: int,
        tokens_out: int,
        cost_thb: float,
        confidence: float,
        validation_status: str,
        validation_issues: list,
    ) -> str:
        new_id = str(uuid.uuid4())
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE enrichment_cache SET superseded_at=CURRENT_TIMESTAMP "
                "WHERE sku=? AND superseded_at IS NULL",
                (sku,),
            )
            conn.execute(
                "INSERT INTO enrichment_cache "
                "(id, sku, category, prompt_hash, evidence_hash, prompt_text, "
                " response_json, response_raw, model, tokens_in, tokens_out, "
                " cost_thb, confidence, validation_status, validation_issues) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    new_id, sku, category, prompt_hash, evidence_hash, prompt_text,
                    json.dumps(response_json, ensure_ascii=False), response_raw,
                    model, tokens_in, tokens_out, cost_thb, confidence,
                    validation_status, json.dumps(validation_issues, ensure_ascii=False),
                ),
            )
            conn.commit()
        finally:
            conn.close()
        return new_id


class FailureLogger:
    """Captures parse + validation failures locally (not synced to Supabase)."""

    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)

    def log(
        self,
        sku: str,
        failure_type: str,                 # 'parse' | 'validation_first' | 'validation_retry'
        raw_response: str | None,
        validation_issues: list,
        prompt_hash: str | None = None,
        evidence_hash: str | None = None,
        model: str | None = None,
        tokens_in: int | None = None,
        tokens_out: int | None = None,
        cost_thb: float | None = None,
    ) -> str:
        new_id = str(uuid.uuid4())
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute(
                "INSERT INTO enrichment_failures "
                "(id, sku, failure_type, raw_response, validation_issues, "
                " prompt_hash, evidence_hash, model, tokens_in, tokens_out, cost_thb) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (
                    new_id, sku, failure_type, raw_response,
                    json.dumps(validation_issues, ensure_ascii=False),
                    prompt_hash, evidence_hash, model, tokens_in, tokens_out, cost_thb,
                ),
            )
            conn.commit()
        finally:
            conn.close()
        return new_id
