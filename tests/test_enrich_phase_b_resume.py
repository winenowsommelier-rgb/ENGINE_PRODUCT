"""Phase B PAID-PATH resume/cost-safety tests (Rule 4 / Rule 10).

ZERO network, ZERO spend. These exercise only the resume LOGIC — load_done_skus()
reading a sidecar file off disk, and the done-skus filter on selected rows. The
executor / paid loop is NOT exercised here (that needs the real API).

Why this exists (cost safety):
  * The sidecar was opened with "w" (truncate) and there was no resume, so a
    re-run after a mid-run failure RE-PAID for everything AND destroyed the
    completed work. load_done_skus + the --skip-done filter let a re-run append
    to prior results and only pay for the SKUs not already done.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from scripts.enrich_phase_b import filter_undone, load_done_skus  # noqa: E402


def _write_sidecar(path: Path, records) -> None:
    with path.open("w") as fh:
        for rec in records:
            fh.write(json.dumps(rec) + "\n")


# --- load_done_skus -------------------------------------------------------

def test_load_done_skus_empty_for_missing_path(tmp_path):
    """A non-existent sidecar path => empty set (fresh run, nothing done)."""
    missing = tmp_path / "does_not_exist.jsonl"
    assert load_done_skus(missing) == set()


def test_load_done_skus_reads_all_statuses(tmp_path):
    """Every sku already present counts as done — including api_error rows, so a
    resume does not silently re-pay for a SKU that already errored (operator can
    re-run with a fresh --ts if they want to retry errors)."""
    sidecar = tmp_path / "side.jsonl"
    _write_sidecar(
        sidecar,
        [
            {"sku": "A", "status": "ok", "variety": "Bourbon", "body": "Medium"},
            {"sku": "B", "status": "api_error: overloaded", "variety": None,
             "body": None},
        ],
    )
    assert load_done_skus(sidecar) == {"A", "B"}


def test_load_done_skus_tolerates_blank_and_malformed_lines(tmp_path):
    """A truncated/partial last line (crash mid-write) must not crash the resume
    scan — skip unparseable lines, keep the good skus."""
    sidecar = tmp_path / "side.jsonl"
    with sidecar.open("w") as fh:
        fh.write(json.dumps({"sku": "A", "status": "ok"}) + "\n")
        fh.write("\n")                       # blank line
        fh.write('{"sku": "C", "status":')   # truncated / malformed, no newline
    assert load_done_skus(sidecar) == {"A"}


# --- filter_undone --------------------------------------------------------

def test_filter_undone_drops_done_skus():
    """Given sidecar has sku 'A', selected rows [A, B] -> only [B] survives."""
    rows = [{"sku": "A", "name": "Aaa"}, {"sku": "B", "name": "Bbb"}]
    out = filter_undone(rows, {"A"})
    assert [r["sku"] for r in out] == ["B"]


def test_filter_undone_empty_done_keeps_all():
    """No done skus -> every selected row survives (fresh run)."""
    rows = [{"sku": "A"}, {"sku": "B"}]
    assert filter_undone(rows, set()) == rows
