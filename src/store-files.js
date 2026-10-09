// File storage under data/: used when no database is configured (handy for local development).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const SEEN_FILE = path.join(config.dataDir, 'seen.json');
const LOCK_FILE = path.join(config.dataDir, 'print.lock');
const LOCK_STALE_MS = 30 * 60e3;
const editionFile = (date) => path.join(config.editionsDir, `${date}.json`);
const kvFile = (name) => path.join(config.dataDir, `${name}.json`);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export const describe = () => `files in ${path.relative(process.cwd(), config.dataDir) || config.dataDir}`;

function editionDates() {
  if (!fs.existsSync(config.editionsDir)) return [];
  return fs
    .readdirSync(config.editionsDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort()
    .reverse();
}

/** Same shape as the MySQL backend's listEditions: newest first, no article bodies. */
export async function listEditions() {
  return editionDates()
    .map((date) => readJson(editionFile(date), null))
    .filter(Boolean)
    .map((e) => ({
      date: e.date,
      issue: e.issue,
      articles: e.articles.length,
      briefs: e.briefs.length,
      lead: e.articles.find((a) => a.lead)?.headline ?? null,
      ai: Boolean(e.ai?.used),
      model: e.ai?.model ?? null,
      cost: e.ai?.used ? e.ai.estCostUsd : 0,
      generatedAt: e.generatedAt,
    }));
}

export const editionExists = async (date) => fs.existsSync(editionFile(date));
export const loadEdition = async (date) => readJson(editionFile(date), null);
export const saveEdition = async (edition) => writeJson(editionFile(edition.date), edition);

export const loadSeen = async () => readJson(SEEN_FILE, {});

export async function setSeenForDate(date, links, cutoff) {
  const seen = readJson(SEEN_FILE, {});
  for (const [link, d] of Object.entries(seen)) if (d === date || d < cutoff) delete seen[link];
  for (const link of links) seen[link] = date;
  writeJson(SEEN_FILE, seen);
}

export const getKv = async (name) => readJson(kvFile(name), null);
export const setKv = async (name, value) => writeJson(kvFile(name), value);

export async function acquireLock() {
  fs.mkdirSync(config.dataDir, { recursive: true });
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

export const releaseLock = async () => fs.rmSync(LOCK_FILE, { force: true });
export const close = async () => {};
