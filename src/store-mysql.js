// MySQL / MariaDB storage: editions survive redeploys (e.g. Hostinger's Git deployments wipe data/).
// Tables are prefixed pn_ so they can share a database with other apps.
import mysql from 'mysql2/promise';
import { createHash } from 'node:crypto';
import { config } from './config.js';

let pool;
const getPool = () =>
  (pool ||= mysql.createPool({
    ...config.db,
    charset: 'utf8mb4',
    connectionLimit: 4,
    enableKeepAlive: true,
    connectTimeout: 15000,
  }));

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS pn_editions (
    edition_date  CHAR(10)      NOT NULL PRIMARY KEY,
    issue         INT           NOT NULL,
    lead_headline VARCHAR(500)  NULL,
    article_count INT           NOT NULL,
    brief_count   INT           NOT NULL,
    ai_used       TINYINT(1)    NOT NULL,
    model         VARCHAR(64)   NULL,
    cost_usd      DECIMAL(8,2)  NOT NULL DEFAULT 0,
    generated_at  VARCHAR(32)   NOT NULL,
    data          LONGTEXT      NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS pn_seen (
    link_hash    CHAR(40)  NOT NULL PRIMARY KEY,
    link         TEXT      NOT NULL,
    edition_date CHAR(10)  NOT NULL,
    KEY idx_edition_date (edition_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS pn_kv (
    name       VARCHAR(64) NOT NULL PRIMARY KEY,
    value      LONGTEXT    NOT NULL,
    updated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS pn_locks (
    name        VARCHAR(64) NOT NULL PRIMARY KEY,
    acquired_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

let ready;
/** Create the tables on first use. */
function init() {
  ready ||= (async () => {
    for (const sql of SCHEMA) await getPool().query(sql);
  })().catch((err) => {
    ready = null; // let the next call retry, e.g. after the database comes back
    throw err;
  });
  return ready;
}

async function q(sql, params) {
  await init();
  const [rows] = await getPool().query(sql, params);
  return rows;
}

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

export const describe = () => `MySQL database "${config.db.database}" on ${config.db.host}`;

export async function serverVersion() {
  const [row] = await q('SELECT VERSION() AS v');
  return row.v;
}

export async function listEditions() {
  const rows = await q(
    `SELECT edition_date, issue, lead_headline, article_count, brief_count, ai_used, model, cost_usd, generated_at
       FROM pn_editions ORDER BY edition_date DESC`,
  );
  return rows.map((r) => ({
    date: r.edition_date,
    issue: r.issue,
    articles: r.article_count,
    briefs: r.brief_count,
    lead: r.lead_headline,
    ai: Boolean(r.ai_used),
    model: r.model,
    cost: Number(r.cost_usd),
    generatedAt: r.generated_at,
  }));
}

export async function editionExists(date) {
  const rows = await q('SELECT 1 FROM pn_editions WHERE edition_date = ?', [date]);
  return rows.length > 0;
}

export async function loadEdition(date) {
  const rows = await q('SELECT data FROM pn_editions WHERE edition_date = ?', [date]);
  return rows.length ? JSON.parse(rows[0].data) : null;
}

export async function saveEdition(e) {
  const lead = e.articles.find((a) => a.lead)?.headline ?? null;
  await q(
    `INSERT INTO pn_editions
       (edition_date, issue, lead_headline, article_count, brief_count, ai_used, model, cost_usd, generated_at, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE issue = VALUES(issue), lead_headline = VALUES(lead_headline),
       article_count = VALUES(article_count), brief_count = VALUES(brief_count), ai_used = VALUES(ai_used),
       model = VALUES(model), cost_usd = VALUES(cost_usd), generated_at = VALUES(generated_at), data = VALUES(data)`,
    [
      e.date,
      e.issue,
      lead ? lead.slice(0, 500) : null,
      e.articles.length,
      e.briefs.length,
      e.ai?.used ? 1 : 0,
      e.ai?.model ?? null,
      e.ai?.used ? e.ai.estCostUsd : 0,
      e.generatedAt,
      JSON.stringify(e),
    ],
  );
}

export async function loadSeen() {
  const rows = await q('SELECT link, edition_date FROM pn_seen');
  return Object.fromEntries(rows.map((r) => [r.link, r.edition_date]));
}

/** Replace the links printed in this date's edition, and forget anything older than cutoff. */
export async function setSeenForDate(date, links, cutoff) {
  await init();
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM pn_seen WHERE edition_date = ? OR edition_date < ?', [date, cutoff]);
    if (links.length) {
      await conn.query('INSERT INTO pn_seen (link_hash, link, edition_date) VALUES ? ON DUPLICATE KEY UPDATE edition_date = VALUES(edition_date)', [
        links.map((link) => [sha1(link), link, date]),
      ]);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

export async function getKv(name) {
  const rows = await q('SELECT value FROM pn_kv WHERE name = ?', [name]);
  return rows.length ? JSON.parse(rows[0].value) : null;
}

export async function setKv(name, value) {
  await q('INSERT INTO pn_kv (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', [name, JSON.stringify(value)]);
}

// A row in pn_locks means a print run is in progress somewhere; stale after 30 minutes (crashed run).
export async function acquireLock() {
  await q("DELETE FROM pn_locks WHERE name = 'print' AND acquired_at < NOW() - INTERVAL 30 MINUTE");
  try {
    await q("INSERT INTO pn_locks (name) VALUES ('print')");
    return true;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return false;
    throw err;
  }
}

export const releaseLock = () => q("DELETE FROM pn_locks WHERE name = 'print'");
export const close = async () => {
  if (pool) await pool.end();
  pool = null;
};
