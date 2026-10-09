import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const int = (v, d) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));

export const config = {
  paperName: process.env.PAPER_NAME || 'The Para News',
  port: int(process.env.PORT, 3000),
  // Daily print time and on/off live in data/settings.json (edited from /admin); see settings.js.
  timezone: process.env.TZ_NAME || Intl.DateTimeFormat().resolvedOptions().timeZone,
  // Password for the hidden /admin page. Admin is disabled when unset.
  adminPassword: process.env.ADMIN_PASSWORD || '',
  // Only consider posts newer than this many hours.
  lookbackHours: int(process.env.LOOKBACK_HOURS, 36),
  // Full articles per edition (the rest of the good candidates become one-line briefs).
  maxArticles: int(process.env.MAX_ARTICLES, 18),
  maxBriefs: int(process.env.MAX_BRIEFS, 12),
  model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
  editorEffort: process.env.EDITOR_EFFORT || 'medium',
  writerEffort: process.env.WRITER_EFFORT || 'low',
  writerConcurrency: int(process.env.WRITER_CONCURRENCY, 4),
  // AI_MODE=off forces the no-AI "raw wire copy" mode.
  aiEnabled: (process.env.AI_MODE || 'on').toLowerCase() !== 'off',
  userAgent:
    process.env.USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  // MySQL/MariaDB (e.g. a Hostinger database). When DB_HOST is unset, everything is stored in data/ instead.
  db: process.env.DB_HOST
    ? {
        host: process.env.DB_HOST,
        port: int(process.env.DB_PORT, 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
      }
    : null,
  dataDir: path.join(ROOT, 'data'),
  editionsDir: path.join(ROOT, 'data', 'editions'),
};

export function loadSources() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'sources.json'), 'utf8'));
  return { sections: raw.sections, sources: raw.sources.filter((s) => s.enabled !== false) };
}
