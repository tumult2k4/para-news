import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.editionsDir, { recursive: true });

const SEEN_FILE = path.join(config.dataDir, 'seen.json');
const STATUS_FILE = path.join(config.dataDir, 'status.json');
const editionFile = (date) => path.join(config.editionsDir, `${date}.json`);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function listEditionDates() {
  return fs
    .readdirSync(config.editionsDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort()
    .reverse();
}

export const editionExists = (date) => fs.existsSync(editionFile(date));
export const loadEdition = (date) => readJson(editionFile(date), null);
export const saveEdition = (edition) => writeJson(editionFile(edition.date), edition);

/** Links already printed, mapped to the edition date that printed them. */
export const loadSeen = () => readJson(SEEN_FILE, {});

export function saveSeen(seen) {
  // Forget anything older than 90 days; the lookback window keeps old posts out anyway.
  const cutoff = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  for (const [link, date] of Object.entries(seen)) if (date < cutoff) delete seen[link];
  writeJson(SEEN_FILE, seen);
}

// Cross-process lock so the web server's cron and a Windows scheduled task can't print at the same time.
const LOCK_FILE = path.join(config.dataDir, 'print.lock');
const LOCK_STALE_MS = 30 * 60e3;

export function acquireLock() {
  try {
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    if (Date.now() - fs.statSync(LOCK_FILE).mtimeMs > LOCK_STALE_MS) {
      fs.rmSync(LOCK_FILE, { force: true });
      return acquireLock();
    }
    return false;
  }
}

export const releaseLock = () => fs.rmSync(LOCK_FILE, { force: true });

export const loadStatus = () => readJson(STATUS_FILE, {});
export const saveStatus = (status) => writeJson(STATUS_FILE, { ...loadStatus(), ...status });
