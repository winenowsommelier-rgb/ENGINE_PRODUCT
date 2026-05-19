"""Supabase enrichment_cache R/W via PostgREST HTTP."""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class CacheClient:
    def __init__(self, supabase_url: str, api_key: str):
        self.url = supabase_url.rstrip("/")
        self.api_key = api_key

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        h = {
            "apikey": self.api_key,
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        if extra:
            h.update(extra)
        return h

    def lookup(self, sku: str, prompt_hash: str, evidence_hash: str) -> dict[str, Any] | None:
        params = {
            "sku": f"eq.{sku}",
            "prompt_hash": f"eq.{prompt_hash}",
            "evidence_hash": f"eq.{evidence_hash}",
            "superseded_at": "is.null",
            "select": "id,sku,category,prompt_hash,evidence_hash,response_json,model,tokens_in,tokens_out,cost_thb,confidence,validation_status,validation_issues",
            "limit": "1",
        }
        qs = urllib.parse.urlencode(params)
        url = f"{self.url}/rest/v1/enrichment_cache?{qs}"
        req = urllib.request.Request(url, headers=self._headers())
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data[0] if data else None
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"cache lookup failed: {e.code} {e.read().decode('utf-8', errors='replace')[:200]}")

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
        # Step 1: supersede any active prior row for this SKU
        supersede_url = f"{self.url}/rest/v1/enrichment_cache?sku=eq.{urllib.parse.quote(sku)}&superseded_at=is.null"
        supersede_body = json.dumps({"superseded_at": "now()"}).encode("utf-8")
        req = urllib.request.Request(
            supersede_url,
            data=supersede_body,
            method="PATCH",
            headers=self._headers({"Prefer": "return=minimal"}),
        )
        try:
            with urllib.request.urlopen(req, timeout=30):
                pass
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"cache supersede failed: {e.code} {e.read().decode('utf-8', errors='replace')[:200]}")

        # Step 2: insert new row
        insert_url = f"{self.url}/rest/v1/enrichment_cache"
        new_row = {
            "sku": sku,
            "category": category,
            "prompt_hash": prompt_hash,
            "evidence_hash": evidence_hash,
            "prompt_text": prompt_text,
            "response_json": response_json,
            "response_raw": response_raw,
            "model": model,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_thb": cost_thb,
            "confidence": confidence,
            "validation_status": validation_status,
            "validation_issues": validation_issues,
        }
        body = json.dumps(new_row).encode("utf-8")
        req = urllib.request.Request(
            insert_url,
            data=body,
            method="POST",
            headers=self._headers({"Prefer": "return=representation"}),
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data[0]["id"] if data else ""
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"cache insert failed: {e.code} {e.read().decode('utf-8', errors='replace')[:200]}")
