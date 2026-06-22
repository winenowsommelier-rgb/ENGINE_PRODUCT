// apps/catalog/lib/attribute-map.ts
// Mirror of data/lib/taxonomy/attribute_map.py. Parity guarded by tests/test_attribute_map_parity.py.
export const ATTRIBUTE_MAP: Record<string, string> = {
  grape_variety: "variety",
  grape_blend_type: "blend_type",
  wine_body: "body",
  wine_acidity: "acidity",
  wine_tannin: "tannin",
  wine_color: "color",
  wine_production_style: "production_style",
};
export const NEW_COLUMNS = ["sweetness", "intensity", "smokiness", "finish"] as const;
export const DROPPED_COLUMNS = ["wine_type", "other_type"] as const;
