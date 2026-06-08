// SQLite connection — the shared context layer every agent reads/writes.
// One file, synchronous API (better-sqlite3). Schema is applied on first open.
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DB_PATH = process.env.NEXUS_DB_PATH || join(__dirname, 'nexus.db');
const SCHEMA_PATH = join(__dirname, 'schema.sql');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Idempotent: schema.sql uses CREATE TABLE IF NOT EXISTS throughout.
db.exec(readFileSync(SCHEMA_PATH, 'utf8'));

// ── additive migrations ──────────────────────────────────────────────────────
// New COLUMNS on existing tables can't come from CREATE TABLE IF NOT EXISTS, so
// add them here, guarded by PRAGMA table_info. The hierarchy layer (Phase 9)
// adds parent_id + node_type + is_concept to notes — additive, the flat
// shared-tag graph is untouched. `node_type` is the second-brain taxonomy
// (journal | research | concept | archivist | note | brief); the legacy `kind`
// column keeps its CHECK and stays for backward-compat (a SQLite CHECK can't be
// altered in place, so new node kinds live in node_type, not kind).
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('notes', 'parent_id', 'parent_id INTEGER REFERENCES notes(id)');
ensureColumn('notes', 'is_concept', 'is_concept INTEGER NOT NULL DEFAULT 0');
ensureColumn('notes', 'node_type', 'node_type TEXT');
// backfill node_type for pre-existing rows from their kind (one-time, idempotent)
db.exec(`UPDATE notes SET node_type = CASE kind
           WHEN 'project' THEN 'archivist' ELSE kind END
         WHERE node_type IS NULL`);
db.prepare("CREATE INDEX IF NOT EXISTS idx_notes_parent ON notes(parent_id)").run();
db.prepare("CREATE INDEX IF NOT EXISTS idx_notes_node_type ON notes(node_type)").run();

export default db;
