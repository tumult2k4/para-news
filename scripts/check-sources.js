#!/usr/bin/env node
// Health check for every source in sources.json (including disabled ones):
// is it reachable, how many items does it return, and when did it last post?
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { fetchers } from '../src/fetchers.js';
import { mapLimit } from '../src/util.js';

const { sources } = JSON.parse(fs.readFileSync(path.join(ROOT, 'sources.json'), 'utf8'));
const now = Date.now();

const rows = await mapLimit(sources, 6, async (s) => {
  try {
    const items = await fetchers[s.type](s);
    const dates = items.map((i) => i.published && new Date(i.published).getTime()).filter(Boolean);
    const newest = dates.length ? Math.max(...dates) : null;
    const week = dates.filter((d) => now - d < 7 * 864e5).length;
    const ageDays = newest ? Math.floor((now - newest) / 864e5) : null;
    const flag = newest === null ? '?' : ageDays > 14 ? 'STALE' : 'ok';
    return [flag, s.enabled === false ? 'off' : 'on', items.length, newest ? new Date(newest).toISOString().slice(0, 10) : '-', week, s.name];
  } catch (err) {
    return ['FAIL', s.enabled === false ? 'off' : 'on', 0, '-', 0, `${s.name}  (${err.message})`];
  }
});

console.log(['status', 'on?', 'items', 'newest', 'last7d', 'source'].join('\t'));
for (const r of rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])))) console.log(r.join('\t'));
