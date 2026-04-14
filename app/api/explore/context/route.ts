import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";

/* ── SQLite connection (singleton, read-only) ────────── */

let _db: Database.Database | null = null;

function getDb(): Database.Database | null {
  if (_db) return _db;
  const dbPath = path.join(process.cwd(), "data", "taxonomy.db");
  if (!fs.existsSync(dbPath)) return null;
  try {
    _db = new Database(dbPath, { readonly: true });
    return _db;
  } catch {
    return null;
  }
}

/* ── CSV fallback parser ─────────────────────────────── */

interface CsvRow {
  entity_name: string;
  parent_country: string;
  classification_scope: string;
  description_short_en: string;
  description_full_en: string;
}

/**
 * Minimal CSV parser that handles quoted fields (descriptions
 * may contain commas). Does not handle escaped quotes within
 * quoted strings, but that is acceptable for these files.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function readCsvFile(filePath: string): CsvRow[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const nameIdx = headers.indexOf("entity_name");
  const parentIdx = headers.indexOf("parent_country");
  const scopeIdx = headers.indexOf("classification_scope");
  const shortIdx = headers.indexOf("description_short_en");
  const fullIdx = headers.indexOf("description_full_en");

  if (nameIdx < 0 || shortIdx < 0) return [];

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    rows.push({
      entity_name: fields[nameIdx] ?? "",
      parent_country: fields[parentIdx] ?? "",
      classification_scope: fields[scopeIdx] ?? "",
      description_short_en: fields[shortIdx] ?? "",
      description_full_en: fields[fullIdx] ?? "",
    });
  }
  return rows;
}

/* ── Cached CSV data ─────────────────────────────────── */

let _csvCache: Record<string, CsvRow[]> = {};

function getCsvRows(type: string): CsvRow[] {
  if (_csvCache[type]) return _csvCache[type];
  const fileMap: Record<string, string> = {
    country: "country_description_library.csv",
    region: "region_description_library.csv",
    subregion: "subregion_description_library.csv",
  };
  const fileName = fileMap[type];
  if (!fileName) return [];
  const filePath = path.join(process.cwd(), "data", fileName);
  const rows = readCsvFile(filePath);
  _csvCache[type] = rows;
  return rows;
}

/* ── GET handler ─────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get("name")?.trim();
  const type = searchParams.get("type") as "country" | "region" | "subregion" | null;
  const scope = searchParams.get("scope") as string | null;

  if (!name || !type) {
    return NextResponse.json(
      { error: "Missing required params: name, type" },
      { status: 400 }
    );
  }

  // ── 1. Try SQLite (primary source) ──────────────
  const db = getDb();
  if (db) {
    try {
      type SqliteRow = {
        description_short: string | null;
        description_en: string | null;
        attributes: string | null;
        scope_id: string | null;
      };

      let row: SqliteRow | undefined;

      // Try with scope first
      if (scope) {
        row = db
          .prepare(
            `SELECT tc.description_short, tc.description_en, tc.attributes, tc.scope_id
             FROM taxonomy_contexts tc
             JOIN taxonomy_entities te ON te.id = tc.entity_id
             WHERE te.name = ? AND tc.scope_id = ? AND tc.status = 'validated'
             LIMIT 1`
          )
          .get(name, scope) as SqliteRow | undefined;
      }

      // Fall back to any validated result for this entity
      if (!row) {
        row = db
          .prepare(
            `SELECT tc.description_short, tc.description_en, tc.attributes, tc.scope_id
             FROM taxonomy_contexts tc
             JOIN taxonomy_entities te ON te.id = tc.entity_id
             WHERE te.name = ? AND tc.status = 'validated'
             LIMIT 1`
          )
          .get(name) as SqliteRow | undefined;
      }

      if (row) {
        let key_grapes: string[] = [];
        let key_styles: string[] = [];
        let climate: string | null = null;

        if (row.attributes) {
          try {
            const attrs = JSON.parse(row.attributes);
            if (Array.isArray(attrs.key_grapes)) key_grapes = attrs.key_grapes;
            if (Array.isArray(attrs.key_styles)) key_styles = attrs.key_styles;
            if (typeof attrs.climate === "string") climate = attrs.climate;
          } catch {
            // attributes parse failed — skip
          }
        }

        return NextResponse.json({
          name,
          type,
          scope: row.scope_id ?? scope,
          description_short: row.description_short ?? null,
          description_full: row.description_en ?? null,
          key_grapes,
          key_styles,
          climate,
          source: "taxonomy_db",
        });
      }
    } catch {
      // SQLite query failed — fall through to CSV
    }
  }

  // ── 2. CSV fallback ─────────────────────────────
  const rows = getCsvRows(type);
  const match = rows.find(
    (r) => r.entity_name.toLowerCase() === name.toLowerCase()
  );

  if (match) {
    return NextResponse.json({
      name,
      type,
      scope: match.classification_scope || scope || null,
      description_short: match.description_short_en || null,
      description_full: match.description_full_en || null,
      key_grapes: [],
      key_styles: [],
      climate: null,
      source: "csv_library",
    });
  }

  // ── 3. No match ─────────────────────────────────
  return NextResponse.json({
    name,
    type,
    scope: scope || null,
    description_short: null,
    description_full: null,
    key_grapes: [],
    key_styles: [],
    climate: null,
    source: "none",
  });
}
