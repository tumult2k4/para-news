#!/usr/bin/env node
// Connects to the MySQL database from .env, creates the tables and copies anything in data/
// (editions, printed-links ledger, settings) into it. Safe to run more than once:
// editions already in the database are left alone unless you pass --overwrite.
//   npm run db:setup
//   npm run db:setup -- --overwrite
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';

if (!config.db) {
  console.error('No database configured. Set DB_HOST, DB_PORT, DB_USER, DB_PASSWORD and DB_NAME in .env first.');
  process.exit(1);
}

const db = await import('../src/store-mysql.js');
const overwrite = process.argv.includes('--overwrite');
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

try {
  console.log(`Connecting to ${db.describe()} as ${config.db.user}…`);
  console.log(`Connected: ${await db.serverVersion()}. Tables are ready.`);

  const editionsDir = config.editionsDir;
  const files = fs.existsSync(editionsDir) ? fs.readdirSync(editionsDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)) : [];
  let imported = 0;
  for (const file of files.sort()) {
    const edition = readJson(path.join(editionsDir, file));
    if (!edition) continue;
    if (!overwrite && (await db.editionExists(edition.date))) {
      console.log(`  ${edition.date}: already in the database, skipped`);
      continue;
    }
    await db.saveEdition(edition);
    imported++;
    console.log(`  ${edition.date}: imported (No. ${edition.issue}, ${edition.articles.length} articles)`);
  }

  const seen = readJson(path.join(config.dataDir, 'seen.json')) || {};
  const byDate = {};
  for (const [link, date] of Object.entries(seen)) (byDate[date] ||= []).push(link);
  const cutoff = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  for (const [date, links] of Object.entries(byDate)) await db.setSeenForDate(date, links, cutoff);

  for (const name of ['settings', 'status']) {
    const value = readJson(path.join(config.dataDir, `${name}.json`));
    if (value && !(await db.getKv(name))) await db.setKv(name, { ...value, running: false });
  }

  const editions = await db.listEditions();
  console.log(`\nDone: ${imported} edition(s) imported, ${Object.keys(seen).length} printed links carried over.`);
  console.log(`The database now holds ${editions.length} edition(s)${editions.length ? `, newest ${editions[0].date}` : ''}.`);
} catch (err) {
  console.error(`\nDatabase setup failed: ${err.code ? `${err.code}: ` : ''}${err.message}`);
  if (['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(err.code)) {
    console.error('Check DB_HOST/DB_PORT. Connecting from your own PC to Hostinger needs "Remote MySQL" access enabled for your IP in hPanel.');
  } else if (err.code === 'ER_ACCESS_DENIED_ERROR' || err.code === 'ER_DBACCESS_DENIED_ERROR') {
    console.error('Check DB_USER, DB_PASSWORD and DB_NAME (on Hostinger they usually start with u123456789_).');
  }
  process.exitCode = 1;
} finally {
  await db.close();
}
