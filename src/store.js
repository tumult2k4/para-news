// Storage facade: MySQL when DB_HOST is set, otherwise JSON files under data/.
// Every function is async so both backends share one interface.
// No top-level await anywhere in the server's import graph: some hosts (Passenger/LiteSpeed-style
// loaders) start the app with require(), which can't load ES modules that use it.
import { config } from './config.js';
import * as files from './store-files.js';
import * as mysqlStore from './store-mysql.js';

const backend = config.db ? mysqlStore : files;

export const { describe, editionExists, loadSeen, getKv, setKv, acquireLock, releaseLock, close } = backend;

// Editions are read constantly by the public pages, sitemaps and feeds, and only change when one is
// printed, so keep them in memory. The TTL covers prints made by another process (the CLI task).
const TTL_MS = 10 * 60e3;
const MAX_CACHED = 120;
const editionCache = new Map(); // date -> { at, value }
let listCache = null;
const fresh = (entry) => entry && Date.now() - entry.at < TTL_MS;

export async function loadEdition(date) {
  const hit = editionCache.get(date);
  if (fresh(hit)) return hit.value;
  const value = await backend.loadEdition(date);
  if (value) {
    editionCache.set(date, { at: Date.now(), value });
    if (editionCache.size > MAX_CACHED) editionCache.delete(editionCache.keys().next().value);
  }
  return value;
}

/** Summaries of every edition, newest first. */
export async function listEditions() {
  if (fresh(listCache)) return listCache.value;
  listCache = { at: Date.now(), value: await backend.listEditions() };
  return listCache.value;
}

export async function saveEdition(edition) {
  await backend.saveEdition(edition);
  editionCache.clear();
  listCache = null;
}

const SEEN_DAYS = 90;

/** Record the links printed in this date's edition (replacing an earlier print of the same day). */
export function setSeenForDate(date, links) {
  // Forget anything older than 90 days; the lookback window keeps old posts out anyway.
  const cutoff = new Date(Date.now() - SEEN_DAYS * 864e5).toISOString().slice(0, 10);
  return backend.setSeenForDate(date, links, cutoff);
}

export const loadStatus = async () => (await getKv('status')) || {};
export const saveStatus = async (patch) => setKv('status', { ...(await loadStatus()), ...patch });
