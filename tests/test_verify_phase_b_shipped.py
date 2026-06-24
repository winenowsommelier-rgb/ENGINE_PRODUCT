import json

def test_verify_shipped_detects_missing(tmp_path):
    export = tmp_path / "live_products_export.json"
    export.write_text(json.dumps([{"sku":"A","body":"Full","sweetness":""}]))
    sidecar = tmp_path / "side.jsonl"
    sidecar.write_text(json.dumps(dict(sku="A", body="Full", sweetness="Sweet"))+"\n")
    from scripts.verify_phase_b_shipped import verify
    missing = verify(export_path=export, sidecar_path=sidecar)
    assert ("A", "sweetness") in missing   # sidecar wrote sweetness but export is empty
    assert ("A", "body") not in missing    # export has body

def test_verify_shipped_preexisting_value_not_flagged(tmp_path):
    # NULL-only merge legitimately didn't ship body=Medium because DB already had Full;
    # export shows Full (non-empty) -> NOT missing.
    export = tmp_path / "live_products_export.json"
    export.write_text(json.dumps([{"sku":"A","body":"Full"}]))
    sidecar = tmp_path / "side.jsonl"
    sidecar.write_text(json.dumps(dict(sku="A", body="Medium"))+"\n")
    from scripts.verify_phase_b_shipped import verify
    assert verify(export_path=export, sidecar_path=sidecar) == []
