import { getKv, setKv } from './store.js';

// Settings changed from /admin, persisted in the store (database or data/settings.json).
// Environment variables supply the defaults.
export class SettingsError extends Error {}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const DEFAULTS = {
  autoGenerate: process.env.AUTO_GENERATE !== 'false',
  printTime: TIME_RE.test(process.env.PRINT_TIME || '') ? process.env.PRINT_TIME : '06:00',
};

export async function getSettings() {
  return { ...DEFAULTS, ...((await getKv('settings')) || {}) };
}

export async function updateSettings(patch) {
  const next = await getSettings();
  if ('autoGenerate' in patch) {
    if (typeof patch.autoGenerate !== 'boolean') throw new SettingsError('autoGenerate must be true or false');
    next.autoGenerate = patch.autoGenerate;
  }
  if ('printTime' in patch) {
    if (!TIME_RE.test(patch.printTime)) throw new SettingsError('printTime must look like 06:00');
    next.printTime = patch.printTime;
  }
  await setKv('settings', next);
  return next;
}

/** "06:30" -> "30 6 * * *" */
export function timeToCron(time) {
  const [, h, m] = TIME_RE.exec(time);
  return `${Number(m)} ${Number(h)} * * *`;
}
