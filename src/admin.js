import express from 'express';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config, ROOT, loadSources } from './config.js';
import { runEdition, isRunning } from './pipeline.js';
import { listEditionDates, loadEdition, loadStatus } from './store.js';
import { getSettings, updateSettings } from './settings.js';
import { recentLog, log } from './util.js';

const COOKIE = 'pn_admin';
const SESSION_MS = 12 * 3600e3;
const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 15 * 60e3;

const sessions = new Map(); // token -> expiry (in memory: a restart logs everyone out)
const failures = new Map(); // ip -> { count, since }

const digest = (s) => createHash('sha256').update(String(s)).digest();
const passwordMatches = (given) => config.adminPassword !== '' && timingSafeEqual(digest(given), digest(config.adminPassword));

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function isAuthed(req) {
  const token = readCookie(req, COOKIE);
  const expiry = token && sessions.get(token);
  if (!expiry) return false;
  if (expiry < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  if (!isAuthed(req)) return res.status(401).json({ error: 'Not signed in.' });
  next();
}

/**
 * The hidden admin page at /admin. Nothing on the public site links here.
 * scheduler: { nextRun(): Date|null, apply(): void } so settings changes take effect immediately.
 */
export function createAdminRouter(scheduler) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(express.json({ limit: '10kb' }));
  router.use(express.static(path.join(ROOT, 'admin')));

  router.post('/login', (req, res) => {
    if (!config.adminPassword) return res.status(503).json({ error: 'Admin is disabled: set ADMIN_PASSWORD in .env.' });
    const ip = req.socket.remoteAddress || 'unknown';
    const f = failures.get(ip);
    if (f && Date.now() - f.since < FAIL_WINDOW_MS && f.count >= MAX_FAILS) {
      return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    }
    if (!passwordMatches(req.body?.password ?? '')) {
      const fresh = !f || Date.now() - f.since >= FAIL_WINDOW_MS;
      failures.set(ip, fresh ? { count: 1, since: Date.now() } : { ...f, count: f.count + 1 });
      log(`Admin: failed sign-in from ${ip}`);
      return res.status(401).json({ error: 'Wrong password.' });
    }
    failures.delete(ip);
    const token = randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_MS);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/admin', maxAge: SESSION_MS });
    res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    sessions.delete(readCookie(req, COOKIE));
    res.clearCookie(COOKIE, { path: '/admin' });
    res.json({ ok: true });
  });

  router.get('/api/status', requireAdmin, (req, res) => {
    const editions = listEditionDates()
      .slice(0, 30)
      .map((date) => {
        const e = loadEdition(date);
        return {
          date,
          issue: e?.issue,
          articles: e?.articles?.length ?? 0,
          briefs: e?.briefs?.length ?? 0,
          lead: e?.articles?.find((a) => a.lead)?.headline ?? null,
          ai: Boolean(e?.ai?.used),
          model: e?.ai?.model,
          cost: e?.ai?.used ? e.ai.estCostUsd : 0,
          generatedAt: e?.generatedAt,
        };
      });
    res.json({
      ...loadStatus(),
      running: isRunning(),
      settings: getSettings(),
      nextRun: scheduler.nextRun(),
      timezone: config.timezone,
      model: config.model,
      aiEnabled: config.aiEnabled,
      hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
      sources: loadSources().sources.length,
      editions,
      log: recentLog(),
    });
  });

  router.post('/api/run', requireAdmin, (req, res) => {
    if (isRunning()) return res.status(409).json({ error: 'The presses are already running.' });
    log('Admin: print run requested.');
    runEdition({ force: true }).catch(() => {});
    res.status(202).json({ started: true });
  });

  router.put('/api/settings', requireAdmin, (req, res) => {
    try {
      const settings = updateSettings(req.body || {});
      scheduler.apply();
      log(`Admin: auto-print ${settings.autoGenerate ? `ON at ${settings.printTime}` : 'OFF'}.`);
      res.json({ settings, nextRun: scheduler.nextRun() });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
