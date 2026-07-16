import re

from data.lib.dossier.validators import (
    contains_price_language,
    contains_banned_phrase,
    ngram_overlap_ratio,
    provenance_has_source_for_sourced_fields,
    validate_against_schema,
    KNOWN_PROVENANCE_FIELDS,
)


def test_price_language_detected():
    assert contains_price_language("At only ฿1,200 this is a steal") is True
    assert contains_price_language("A classic Bordeaux blend with dark fruit") is False


def test_investment_language_detected():
    assert contains_price_language("A superb investment for your collection") is True


def test_banned_marketing_phrase_detected():
    assert contains_banned_phrase("Notes of blackcurrant and cedar") is True  # "notes of"
    assert contains_banned_phrase("A hidden gem from Tuscany") is True
    assert contains_banned_phrase("Produced in the Chianti hills using traditional methods") is False


def test_ngram_overlap_flags_near_verbatim_copy():
    source_text = "This wine shows remarkable depth with notes of dark cherry and tobacco leaf on the long finish"
    generated = "This wine shows remarkable depth with notes of dark cherry and tobacco leaf lingering"
    ratio = ngram_overlap_ratio(generated, source_text, n=6)
    assert ratio > 0.5


def test_ngram_overlap_low_for_original_prose():
    source_text = "This wine shows remarkable depth with notes of dark cherry and tobacco leaf on the long finish"
    generated = "A structured red with firm tannins, best paired with grilled meats"
    ratio = ngram_overlap_ratio(generated, source_text, n=6)
    assert ratio < 0.1


def test_provenance_requires_source_url_for_sourced_confidence():
    good = {"expert_note": {"confidence": "sourced", "source_urls": ["https://x.com"]}}
    bad = {"expert_note": {"confidence": "sourced", "source_urls": []}}
    assert provenance_has_source_for_sourced_fields(good) == []
    assert provenance_has_source_for_sourced_fields(bad) == ["expert_note"]


def test_schema_validation_rejects_unknown_provenance_key():
    import json
    from pathlib import Path
    schema = json.loads(
        (Path(__file__).resolve().parent.parent /
         "data/lib/dossier/schema/dossier_response.schema.json").read_text()
    )
    bad_response = {
        "wine_key": "sassicaia",
        "provenance": {"soem_typo_field": {"confidence": "sourced", "source_urls": []}},
    }
    errors = validate_against_schema(bad_response, schema)
    assert errors  # typo'd key should not silently pass


def test_known_provenance_fields_is_subset_of_actual_db_columns():
    """Regression guard: KNOWN_PROVENANCE_FIELDS must stay a subset of the
    real dossier DB columns (scripts/migrate_dossier_schema.py), else a
    legitimate field gets flagged as an 'unknown provenance key' false
    positive. Parses column names out of SCHEMA_SQL rather than executing
    it -- no DB file is created."""
    from pathlib import Path

    migrate_src = (
        Path(__file__).resolve().parent.parent / "scripts" / "migrate_dossier_schema.py"
    ).read_text()

    # Pull the SCHEMA_SQL triple-quoted string out and collect column names
    # (first token of each comma-separated "name TYPE..." definition inside
    # a CREATE TABLE body -- some lines declare more than one column, e.g.
    # "drink_from_year INTEGER, drink_to_year INTEGER,").
    schema_sql = re.search(r'SCHEMA_SQL = """(.*?)"""', migrate_src, re.DOTALL).group(1)
    columns = set()
    for table_body in re.findall(r"CREATE TABLE IF NOT EXISTS \w+ \((.*?)\n\);", schema_sql, re.DOTALL):
        for part in table_body.replace("\n", " ").split(","):
            part = part.strip()
            if not part or part.upper().startswith(("CHECK", "PRIMARY KEY", "FOREIGN KEY", "UNIQUE")):
                continue
            columns.add(part.split()[0])

    missing = KNOWN_PROVENANCE_FIELDS - columns
    assert not missing, f"KNOWN_PROVENANCE_FIELDS has entries not in the real DB schema: {missing}"
