import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Settings changed from /admin, persisted in data/settings.json. Environment variables supply the defaults.
const FILE = path.join(config.dataDir, 'settings.json');
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const DEFAULTS = {
  autoGenerate: process.env.AUTO_GENERATE !== 'false',
  printTime: TIME_RE.test(process.env.PRINT_TIME || '') ? process.env.PRINT_TIME : '06:00',
};

export function getSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function updateSettings(patch) {
  const next = getSettings();
  if ('autoGenerate' in patch) {
    if (typeof patch.autoGenerate !== 'boolean') throw new Error('autoGenerate must be true or false');
    next.autoGenerate = patch.autoGenerate;
  }
  if ('printTime' in patch) {
    if (!TIME_RE.test(patch.printTime)) throw new Error('printTime must look like 06:00');
    next.printTime = patch.printTime;
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}

/** "06:30" -> "30 6 * * *" */
export function timeToCron(time) {
  const [, h, m] = TIME_RE.exec(time);
  return `${Number(m)} ${Number(h)} * * *`;
}
