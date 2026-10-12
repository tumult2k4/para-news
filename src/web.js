// Public, server-rendered site: pages, legacy redirects, sitemaps and feeds.
import express from 'express';
import { listEditions, loadEdition } from './store.js';
import { SECTIONS, prepareEdition, editionPath, sectionBySlug, sectionPath, siteOrigin } from './site.js';
import { frontPage, editionPage, articlePage, sectionPage, archivePage, aboutPage, notFoundPage, emptyPage } from './render.js';
import { robotsTxt, sitemapXml, newsSitemapXml, rssXml } from './feeds.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HTML_CACHE = 'public, max-age=300, stale-while-revalidate=600';
const FEED_CACHE = 'public, max-age=900';

// The store caches raw editions, so memoizing on the object keeps slugs computed once per load.
const prepared = new WeakMap();
async function getEdition(date) {
  const raw = await loadEdition(date);
  if (!raw) return null;
  if (!prepared.has(raw)) prepared.set(raw, prepareEdition(raw));
  return prepared.get(raw);
}

async function getEditions(dates) {
  const out = [];
  for (const d of dates) {
    const e = await getEdition(d);
    if (e) out.push(e);
  }
  return out;
}

async function context(req) {
  const editions = await listEditions();
  return { origin: siteOrigin(req), editions, latest: editions[0] ? await getEdition(editions[0].date) : null };
}

function sendHtml(res, page, status = 200) {
  res.status(status).set('Cache-Control', status === 200 ? HTML_CACHE : 'no-store').type('html').send(String(page));
}

function sendXml(res, body, type = 'application/xml') {
  res.set('Cache-Control', FEED_CACHE).type(type).send(body);
}

export function createSiteRouter() {
  const router = express.Router({ strict: true });

  router.get('/', async (req, res) => {
    // Old client-side URLs: /?date=2026-10-08
    if (DATE_RE.test(String(req.query.date || ''))) return res.redirect(301, editionPath(req.query.date));
    const ctx = await context(req);
    if (!ctx.latest) return sendHtml(res.set('Retry-After', '600'), emptyPage(ctx), 503);
    sendHtml(res, frontPage(ctx, ctx.latest));
  });

  router.get('/index.html', (req, res) => res.redirect(301, '/'));

  // Editions: /2026/10/12/  and articles: /2026/10/12/some-headline-slug
  // Groups: year, month, day, slash after the day, article slug, trailing slash.
  router.get(/^\/(\d{4})\/(\d{2})\/(\d{2})(?:(\/)([a-z0-9-]+)?(\/)?)?$/, async (req, res, next) => {
    const [y, m, d, daySlash, slug, trailing] = [0, 1, 2, 3, 4, 5].map((i) => req.params[i]);
    const date = `${y}-${m}-${d}`;
    if (!daySlash || (!slug && trailing)) return res.redirect(301, editionPath(date)); // /2026/10/12 -> /2026/10/12/
    if (slug && trailing) return res.redirect(301, `${editionPath(date)}${slug}`); // articles have no trailing slash
    const ctx = await context(req);
    const edition = await getEdition(date);
    if (!edition) return next();
    if (!slug) return sendHtml(res, editionPage(ctx, edition));
    const article = edition.articles.find((a) => a.slug === slug);
    if (!article) return next();
    sendHtml(res, articlePage(ctx, edition, article));
  });

  router.get('/section/:slug', async (req, res, next) => {
    const id = sectionBySlug(req.params.slug);
    if (!id) return next();
    const ctx = await context(req);
    const recent = await getEditions(ctx.editions.slice(0, 30).map((e) => e.date));
    const entries = recent
      .flatMap((e) => e.articles.filter((a) => a.section === id).map((article) => ({ article, date: e.date })))
      .slice(0, 60);
    sendHtml(res, sectionPage(ctx, id, entries));
  });
  // Section ids from older links (e.g. /section/skies) -> keyword slug
  router.get('/section/:id', (req, res, next) => (SECTIONS[req.params.id] ? res.redirect(301, sectionPath(req.params.id)) : next()));

  router.get('/archive', async (req, res) => sendHtml(res, archivePage(await context(req))));
  router.get('/about', async (req, res) => sendHtml(res, aboutPage(await context(req))));

  router.get('/robots.txt', (req, res) => res.set('Cache-Control', FEED_CACHE).type('text/plain').send(robotsTxt(siteOrigin(req))));

  router.get('/sitemap.xml', async (req, res) => {
    const editions = await getEditions((await listEditions()).map((e) => e.date));
    sendXml(res, sitemapXml(siteOrigin(req), editions));
  });

  router.get('/news-sitemap.xml', async (req, res) => {
    const editions = await getEditions((await listEditions()).slice(0, 3).map((e) => e.date));
    sendXml(res, newsSitemapXml(siteOrigin(req), editions));
  });

  router.get('/feed.xml', async (req, res) => {
    const editions = await getEditions((await listEditions()).slice(0, 4).map((e) => e.date));
    sendXml(res, rssXml(siteOrigin(req), editions), 'application/rss+xml');
  });

  return router;
}

/** Last stop for GET requests: a real 404 page (with a 404 status, so it never gets indexed). */
export async function notFound(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(404).end();
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  sendHtml(res, notFoundPage(await context(req)), 404);
}
