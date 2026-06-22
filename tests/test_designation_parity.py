"""TS lib/designation.ts and scripts/backfill_designation.py must agree."""
import importlib.util, pathlib
spec = importlib.util.spec_from_file_location(
    "backfill_designation",
    pathlib.Path(__file__).resolve().parent.parent / "scripts" / "backfill_designation.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
designation_for = mod.designation_for_name

CASES = {
    "Chablis Grand Cru Les Clos": "Grand Cru",
    "Chianti Classico DOCG 2019": "DOCG",
    "Feudi Primitivo di Manduria DOC": "DOC",
    "Masseto Toscana IGT 2021": "IGT",
    "Champagne Extra Brut": "Extra Brut",
    "Tosti Prosecco DOC Extra Dry": "DOC",
    "Rioja Gran Reserva 2015": "Gran Reserva",
    "Tempranillo Reserva": "Reserva",
    "Cognac VSOP": "VSOP",
    "Glenfiddich Single Malt": "Single Malt",
    # Spirit grade must beat soft modifiers (ordering bug caught in review):
    "Hennessy XO Limited Edition 2024": "XO",
    "Pyrat Rum XO Reserve": "XO",
    # Accented end-of-token: boundary MUST be (?![a-z]) in BOTH engines:
    "Chateau Margaux 4Ème Cru Classé": "Cru Classé",
    "Yellow Tail Shiraz": None,
    "Doctorow Estate Red": None,
}

def test_python_resolver_matches_expected():
    for name, expected in CASES.items():
        assert designation_for(name) == expected, f"{name!r} -> {designation_for(name)!r}, want {expected!r}"
