import fs from 'node:fs';
import path from 'node:path';

export interface DesignationDescriptionData {
  short: string;
  full: string;
  citation: string;
}

/**
 * SERVER-ONLY loader for the static designation-description copy. Mirrors
 * map-data.server.ts's convention: read once, cache for the process
 * lifetime, throw loudly on a missing file rather than let every lookup
 * silently resolve to null (which would be indistinguishable from a
 * genuine 0-count case).
 */
function dataPath(): string {
  const candidates = [
    path.join(process.cwd(), 'data', 'designation_descriptions.json'),
    path.join(process.cwd(), '..', '..', 'data', 'designation_descriptions.json'),
    process.env.DESIGNATION_DESCRIPTIONS_PATH ?? '',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('designation_descriptions.json not found');
  return found;
}

let _cache: Record<string, DesignationDescriptionData> | null = null;
export function loadDesignationDescriptions(): Record<string, DesignationDescriptionData> {
  if (_cache) return _cache;
  _cache = JSON.parse(fs.readFileSync(dataPath(), 'utf8')) as Record<string, DesignationDescriptionData>;
  return _cache;
}
