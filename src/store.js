// Storage facade: MySQL when DB_HOST is set, otherwise JSON files under data/.
// Every function is async so both backends share one interface.
import { config } from './config.js';

const backend = config.db ? await import('./store-mysql.js') : await import('./store-files.js');

export const {
  describe,
  listEditions,
  editionExists,
  loadEdition,
  saveEdition,
  loadSeen,
  getKv,
  setKv,
  acquireLock,
  releaseLock,
  close,
} = backend;

const SEEN_DAYS = 90;

/** Record the links printed in this date's edition (replacing an earlier print of the same day). */
export function setSeenForDate(date, links) {
  // Forget anything older than 90 days; the lookback window keeps old posts out anyway.
  const cutoff = new Date(Date.now() - SEEN_DAYS * 864e5).toISOString().slice(0, 10);
  return backend.setSeenForDate(date, links, cutoff);
}

export const loadStatus = async () => (await getKv('status')) || {};
export const saveStatus = async (patch) => setKv('status', { ...(await loadStatus()), ...patch });
