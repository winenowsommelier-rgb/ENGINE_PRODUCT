from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
import sys

BI_ROOT = Path("/Users/admin/Desktop/CLAUDE DATA_WNLQ9 M REPORT ALL")
OUT_PATH = Path(__file__).resolve().parents[1] / "data" / "bi-product-affinities.json"

sys.path.insert(0, str(BI_ROOT))

import duckdb  # type: ignore
import pandas as pd  # type: ignore

from app.lib.sales_by_item_helpers import compute_affinities  # type: ignore


def main() -> None:
    db_path = BI_ROOT / "data" / "processed" / "ecommerce_bi.duckdb"
    if not db_path.exists():
        raise SystemExit(f"BI DuckDB not found: {db_path}")

    con = duckdb.connect(str(db_path), read_only=True)
    pivot = con.execute(
        "SELECT order_id, email, sku FROM marts.mart_pivot_base WHERE is_closed = 1"
    ).fetchdf()
    names_df = con.execute(
        "SELECT DISTINCT base_product_code, product_name FROM staging.dim_product"
    ).fetchdf()
    con.close()

    names = dict(zip(names_df["base_product_code"], names_df["product_name"]))
    pivot["base_product_code"] = pivot["sku"].str[:-2]
    bases = sorted(pivot["base_product_code"].dropna().unique())

    affinities: dict[str, dict[str, object]] = {}
    for base in bases:
        basket_df, customer_df = compute_affinities(pivot[["order_id", "email", "sku"]], base, top_n=10)

        def rows(df: pd.DataFrame) -> list[dict[str, object]]:
            if df.empty:
                return []
            out: list[dict[str, object]] = []
            for _, row in df.iterrows():
                other_base = str(row["base_product_code"])
                out.append(
                    {
                        "rank": int(row["rank"]),
                        "base_product_code": other_base,
                        "product_name": names.get(other_base) or "",
                        "rate": round(float(row["rate"]), 4),
                    }
                )
            return out

        co_order = rows(basket_df)
        co_customer = rows(customer_df)
        if co_order or co_customer:
            affinities[base] = {
                "co_order_affinities": co_order,
                "co_customer_affinities": co_customer,
            }

    payload = {
        "source": "BI marts.mart_pivot_base",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "base_count": len(affinities),
        "affinities": affinities,
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT_PATH} with {len(affinities):,} base products")


if __name__ == "__main__":
    main()
