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

export default db;
