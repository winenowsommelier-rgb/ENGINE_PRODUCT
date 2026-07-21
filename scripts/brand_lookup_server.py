#!/usr/bin/env python3
"""
Product Intelligence API Server — zero dependencies, stdlib only.
Serves brand lookup + reputation signals from products.db and data/brand_lookup.json.

Usage:
  python3 scripts/brand_lookup_server.py          # default port 7821
  python3 scripts/brand_lookup_server.py 7822     # custom port

─── Brand Endpoints ──────────────────────────────────────────────────────────
  GET /health
  GET /resolve?q=Penfolds+Grange+2018
  GET /brand/Penfolds
  GET /brands
  POST /resolve/batch          body: ["name1","name2",...]
  GET /reload                  re-reads brand_lookup.json from disk

─── Reputation Endpoints ─────────────────────────────────────────────────────
  GET /reputation/sku/{sku}    full reputation record for one SKU
  GET /reputation/brand/{brand} aggregate reputation summary for a brand's SKUs
  GET /reputation/tier/{tier}  all SKUs in iconic|premium|established|everyday|unrated
  GET /reputation/signals/{sku} raw per-axis signals rows (from reputation_signals table)
  GET /reputation/stats        tier distribution counts + coverage %

  All reputation endpoints return {"error": "reputation_signals not computed yet"}
  if compute_reputation.py has not been run. Brand/resolve endpoints always work.
"""

import json
import re
import sqlite3
import sys
import unicodedata
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 7821
LOOKUP_PATH = Path(__file__).parent.parent / "data" / "brand_lookup.json"
DB_PATH = Path(__file__).parent.parent / "data" / "db" / "products.db"

_lookup: dict = {}


# ── Brand lookup helpers ───────────────────────────────────────────────────────

def load_lookup() -> dict:
    with open(LOOKUP_PATH, encoding="utf-8") as f:
        return json.load(f)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().lower())


def _strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )


def resolve(query: str) -> dict:
    """Resolve a raw product name or brand string to a canonical brand."""
    if not query:
        return {"brand": None, "matched": None}

    if query in _lookup["by_name"]:
        return {"brand": _lookup["by_name"][query], "matched": "exact_name"}

    q = _norm(query)
    if q in _lookup["aliases"]:
        return {"brand": _lookup["aliases"][q], "matched": "alias"}

    q_plain = _strip_accents(q)
    if q_plain in _lookup["aliases"]:
        return {"brand": _lookup["aliases"][q_plain], "matched": "alias_accent_stripped"}

    best, best_len = None, 0
    for alias, brand in _lookup["aliases"].items():
        if q.startswith(alias) and len(alias) > best_len:
            best, best_len = brand, len(alias)
    if best:
        return {"brand": best, "matched": "prefix"}

    return {"brand": None, "matched": None}


# ── DB helpers ────────────────────────────────────────────────────────────────

def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _has_reputation_cols() -> bool:
    with _db() as conn:
        cur = conn.execute("PRAGMA table_info(products)")
        cols = {r["name"] for r in cur.fetchall()}
        return "reputation_tier" in cols


def _has_signals_table() -> bool:
    with _db() as conn:
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='reputation_signals'"
        )
        return cur.fetchone() is not None


def _row_to_dict(row) -> dict:
    return {k: row[k] for k in row.keys()}


# ── Reputation queries ────────────────────────────────────────────────────────

REPUTATION_PRODUCT_COLS = (
    "sku", "name", "brand", "price", "country", "region",
    "designation", "appellation",
    "reputation_tier", "reputation_composite", "reputation_confidence",
    "reputation_summary",
    "reputation_computed_at",
)


def _reputation_sku(sku: str) -> dict:
    with _db() as conn:
        row = conn.execute(
            f"SELECT {', '.join(REPUTATION_PRODUCT_COLS)} FROM products WHERE sku = ?",
            (sku,)
        ).fetchone()
    if not row:
        return None
    return _row_to_dict(row)


def _reputation_signals_sku(sku: str) -> list:
    if not _has_signals_table():
        return None
    with _db() as conn:
        rows = conn.execute(
            "SELECT axis, score, confidence, method, source_note, computed_at "
            "FROM reputation_signals WHERE sku = ? ORDER BY axis",
            (sku,)
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def _reputation_brand(brand: str) -> dict:
    with _db() as conn:
        rows = conn.execute(
            f"SELECT {', '.join(REPUTATION_PRODUCT_COLS)} FROM products "
            "WHERE brand = ? AND reputation_tier IS NOT NULL "
            "ORDER BY reputation_composite DESC NULLS LAST",
            (brand,)
        ).fetchall()
        total = conn.execute(
            "SELECT COUNT(*) as n FROM products WHERE brand = ?", (brand,)
        ).fetchone()["n"]

    if not rows:
        return {"brand": brand, "total_skus": total, "scored_skus": 0, "skus": []}

    scored = [_row_to_dict(r) for r in rows]
    composites = [r["reputation_composite"] for r in scored if r["reputation_composite"] is not None]
    tier_counts = {}
    for r in scored:
        t = r["reputation_tier"] or "unrated"
        tier_counts[t] = tier_counts.get(t, 0) + 1

    return {
        "brand": brand,
        "total_skus": total,
        "scored_skus": len(scored),
        "avg_composite": round(sum(composites) / len(composites), 1) if composites else None,
        "tier_distribution": tier_counts,
        "skus": scored,
    }


def _reputation_tier(tier: str) -> list:
    valid = {"iconic", "premium", "established", "everyday", "unrated"}
    if tier not in valid:
        return None
    with _db() as conn:
        rows = conn.execute(
            f"SELECT {', '.join(REPUTATION_PRODUCT_COLS)} FROM products "
            "WHERE reputation_tier = ? ORDER BY reputation_composite DESC NULLS LAST",
            (tier,)
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def _reputation_stats() -> dict:
    has_rep = _has_reputation_cols()
    with _db() as conn:
        total = conn.execute(
            "SELECT COUNT(*) as n FROM products WHERE is_active = 1 OR is_active IS NULL"
        ).fetchone()["n"]
        critic_coverage = conn.execute(
            "SELECT COUNT(DISTINCT sku) as n FROM critic_scores WHERE sku IS NOT NULL"
        ).fetchone()["n"]
        dist = {}
        if has_rep:
            tier_rows = conn.execute(
                "SELECT reputation_tier, COUNT(*) as n FROM products "
                "WHERE is_active = 1 OR is_active IS NULL "
                "GROUP BY reputation_tier"
            ).fetchall()
            for r in tier_rows:
                key = r["reputation_tier"] if r["reputation_tier"] else "unrated"
                dist[key] = r["n"]

    return {
        "total_active_skus": total,
        "critic_scores_coverage": critic_coverage,
        "reputation_computed": has_rep and bool(dist),
        "tier_distribution": dist,
        "tier_pct": {
            k: round(v / total * 100, 1) if total else 0
            for k, v in dist.items()
        },
    }


# ── HTTP handler ──────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _json(self, code: int, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> bytes:
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length) if length else b""

    def _require_reputation(self) -> bool:
        """Return False and send error if reputation hasn't been computed yet."""
        if not _has_reputation_cols():
            self._json(503, {
                "error": "reputation_signals not computed yet",
                "hint": "Run: python3 scripts/compute_reputation.py",
            })
            return False
        return True

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        global _lookup
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        qs = parse_qs(parsed.query)

        # ── Brand endpoints ──────────────────────────────────────────────────

        if path == "/health":
            self._json(200, {
                "ok": True,
                "brand_count": _lookup.get("brand_count", 0),
                "sku_count": _lookup.get("sku_count", 0),
                "generated_at": _lookup.get("generated_at", ""),
                "reputation_ready": _has_reputation_cols(),
                "signals_table_ready": _has_signals_table(),
            })

        elif path == "/resolve":
            q = unquote(qs.get("q", [""])[0])
            result = resolve(q)
            result["q"] = q
            self._json(200, result)

        elif path.startswith("/brand/") and not path.startswith("/brand/") + "/reputation":
            # plain /brand/{name} — just the brand lookup info
            brand_name = unquote(path[len("/brand/"):])
            # check if it's /brand/{name} NOT /reputation/brand/{name}
            if not path.startswith("/reputation/"):
                info = _lookup["by_brand"].get(brand_name)
                if info:
                    self._json(200, {"brand": brand_name, **info})
                else:
                    self._json(404, {"error": f"Brand not found: {brand_name}"})

        elif path == "/brands":
            self._json(200, sorted(_lookup["by_brand"].keys()))

        elif path == "/reload":
            _lookup = load_lookup()
            self._json(200, {"ok": True, "brand_count": _lookup["brand_count"]})

        # ── Reputation endpoints ─────────────────────────────────────────────

        elif path == "/reputation/stats":
            self._json(200, _reputation_stats())

        elif path.startswith("/reputation/sku/"):
            if not self._require_reputation():
                return
            sku = unquote(path[len("/reputation/sku/"):])
            data = _reputation_sku(sku)
            if data is None:
                self._json(404, {"error": f"SKU not found: {sku}"})
            else:
                self._json(200, data)

        elif path.startswith("/reputation/signals/"):
            sku = unquote(path[len("/reputation/signals/"):])
            signals = _reputation_signals_sku(sku)
            if signals is None:
                self._json(503, {
                    "error": "reputation_signals table not created yet",
                    "hint": "Run: python3 scripts/compute_reputation.py",
                })
            else:
                self._json(200, {"sku": sku, "signals": signals})

        elif path.startswith("/reputation/brand/"):
            if not self._require_reputation():
                return
            brand = unquote(path[len("/reputation/brand/"):])
            self._json(200, _reputation_brand(brand))

        elif path.startswith("/reputation/tier/"):
            tier = unquote(path[len("/reputation/tier/"):])
            valid = {"iconic", "premium", "established", "everyday", "unrated"}
            if tier not in valid:
                self._json(400, {
                    "error": f"Invalid tier: {tier}",
                    "valid": sorted(valid),
                })
                return
            if not self._require_reputation():
                return
            skus = _reputation_tier(tier)
            self._json(200, {"tier": tier, "count": len(skus), "skus": skus})

        else:
            self._json(404, {"error": "Unknown endpoint"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        if path == "/resolve/batch":
            try:
                names = json.loads(self._body())
                if not isinstance(names, list):
                    self._json(400, {"error": "Body must be a JSON array of strings"})
                    return
                results = []
                for name in names[:500]:
                    r = resolve(str(name))
                    r["q"] = name
                    results.append(r)
                self._json(200, results)
            except json.JSONDecodeError:
                self._json(400, {"error": "Invalid JSON body"})
        else:
            self._json(404, {"error": "Unknown endpoint"})


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    _lookup = load_lookup()
    has_rep = _has_reputation_cols()
    has_sig = _has_signals_table()

    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Product Intelligence API running on http://127.0.0.1:{PORT}")
    print(f"  Brands:     {_lookup['brand_count']} brands, {_lookup['sku_count']} SKUs")
    print(f"  DB:         {DB_PATH}")
    print(f"  Reputation: {'✅ computed' if has_rep else '⏳ not yet — run compute_reputation.py'}")
    print(f"  Signals:    {'✅ table exists' if has_sig else '⏳ not yet'}")
    print()
    print("─── Brand ────────────────────────────────────────────────────────────")
    print(f"  GET  /health")
    print(f"  GET  /resolve?q=Penfolds+Grange+2018")
    print(f"  GET  /brand/Penfolds")
    print(f"  GET  /brands")
    print(f"  POST /resolve/batch          body: [\"name1\",\"name2\"]")
    print(f"  GET  /reload")
    print()
    print("─── Reputation ───────────────────────────────────────────────────────")
    print(f"  GET  /reputation/stats")
    print(f"  GET  /reputation/sku/{{sku}}          (requires compute_reputation.py)")
    print(f"  GET  /reputation/signals/{{sku}}      (requires compute_reputation.py)")
    print(f"  GET  /reputation/brand/{{brand}}      (requires compute_reputation.py)")
    print(f"  GET  /reputation/tier/iconic         (iconic|premium|established|everyday|unrated)")
    print()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
