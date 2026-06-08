// ============================================================
//  app_settings — UI-editable agent settings, layered over config.js.
//
//  A row is a (key → JSON value) override. When a key is absent, the effective
//  getter returns the static default from config.js, so the app behaves exactly
//  as before until the user changes something in Settings. This is what lets the
//  job agent's locations / search terms be edited from the UI instead of code.
//
//  Résumés are real files (server/resumes/*.tex) the scorer reads, so we don't
//  store their content here — we read/write the files in place. That keeps the
//  jobAgent's RESUME_PATHS unchanged: it always reads whatever is on disk.
// ============================================================
import fs from 'node:fs';
import db from './index.js';
import {
  TARGET_CITIES, DA_JOB_TITLES, SWE_JOB_TITLES, RESUME_PATHS,
} from '../config.js';

const readStmt = db.prepare('SELECT value FROM app_settings WHERE key = ?');
const writeStmt = db.prepare(`
  INSERT INTO app_settings (key, value) VALUES (@key, @value)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`);

/** Raw override read (parsed JSON) or undefined when unset. */
export function getSetting(key) {
  const row = readStmt.get(key);
  if (!row) return undefined;
  try { return JSON.parse(row.value); } catch { return undefined; }
}

/** Store an override (any JSON-serializable value). */
export function setSetting(key, value) {
  writeStmt.run({ key, value: JSON.stringify(value) });
  return value;
}

/** Remove an override → effective getter falls back to the config.js default. */
export function clearSetting(key) {
  return db.prepare('DELETE FROM app_settings WHERE key = ?').run(key).changes > 0;
}

// ── job agent: locations + search terms (effective = override ?? default) ─────
const isCity = (c) => c && typeof c.city === 'string' && c.city.trim();
const normCity = (c) => ({
  city: String(c.city).trim(),
  state: String(c.state || '').trim().toUpperCase(),
  adzunaRegion: String(c.adzunaRegion || 'us').trim().toLowerCase() || 'us',
});

export function getJobCities() {
  const o = getSetting('job.cities');
  return Array.isArray(o) && o.length ? o : TARGET_CITIES;
}
export function setJobCities(cities) {
  if (!Array.isArray(cities)) throw new Error('cities must be an array');
  const clean = cities.filter(isCity).map(normCity);
  if (!clean.length) throw new Error('at least one valid city is required');
  return setSetting('job.cities', clean);
}

const normTitles = (arr) => [...new Set((arr || []).map((t) => String(t).trim()).filter(Boolean))];

export function getJobTitles(track) {
  const dflt = track === 'da' ? DA_JOB_TITLES : SWE_JOB_TITLES;
  const o = getSetting(`job.titles.${track}`);
  return Array.isArray(o) && o.length ? o : dflt;
}
export function setJobTitles(track, titles) {
  if (!['da', 'swe'].includes(track)) throw new Error('track must be "da" or "swe"');
  const clean = normTitles(titles);
  if (!clean.length) throw new Error('at least one search term is required');
  return setSetting(`job.titles.${track}`, clean);
}

/** Are these overridden, or still the config defaults? (for the UI to show.) */
export const jobCitiesAreCustom = () => getSetting('job.cities') !== undefined;
export const jobTitlesAreCustom = (track) => getSetting(`job.titles.${track}`) !== undefined;

// ── résumé files (read/written in place at RESUME_PATHS) ──────────────────────
const RESUME_TRACKS = ['da', 'swe'];

export function getResumeMeta(track) {
  const path = RESUME_PATHS[track];
  try {
    const st = fs.statSync(path);
    const content = fs.readFileSync(path, 'utf-8');
    return {
      track, path,
      exists: true,
      chars: content.length,
      lines: content.split('\n').length,
      updatedAt: st.mtime.toISOString(),
      preview: content.slice(0, 280),
    };
  } catch {
    return { track, path, exists: false, chars: 0, lines: 0, updatedAt: null, preview: '' };
  }
}

export const getAllResumeMeta = () => RESUME_TRACKS.map(getResumeMeta);

/** Full résumé text (for the in-UI editor). */
export function getResumeContent(track) {
  if (!RESUME_TRACKS.includes(track)) throw new Error('track must be "da" or "swe"');
  try { return fs.readFileSync(RESUME_PATHS[track], 'utf-8'); } catch { return ''; }
}

/** Replace a résumé file's content (what the scorer compares against). */
export function setResumeContent(track, content) {
  if (!RESUME_TRACKS.includes(track)) throw new Error('track must be "da" or "swe"');
  const text = String(content ?? '');
  if (text.trim().length < 20) throw new Error('résumé content looks empty');
  fs.writeFileSync(RESUME_PATHS[track], text, 'utf-8');
  return getResumeMeta(track);
}
