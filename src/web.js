// Public, server-rendered site: pages, legacy redirects, sitemaps and feeds.
import express from 'express';
import { listEditions, loadEdition } from './store.js';
import { SECTIONS, prepareEdition, editionPath, sectionBySlug, sectionPath, siteOrigin } from './site.js';
import { frontPage, editionPage, articlePage, sectionPage, archivePage, archiveUrl, aboutPage, notFoundPage, emptyPage } from './render.js';
import { robotsTxt, sitemapXml, newsSitemapXml, rssXml } from './feeds.js';
import { articleIndex, filterArticles, facets, SORTS } from './archive.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HTML_CACHE = 'public, max-age=300, stale-while-revalidate=600';
const FEED_CACHE = 'public, max-age=900';
const ARCHIVE_PAGE_SIZE = 25;

// The store caches raw editions, so memoizing on the object keeps slugs computed once per load.
const prepared = new WeakMap();
async function getEdition(date) {
  const raw = await loadEdition(date);
  if (!raw) return null;
  if (!prepared.has(raw)) prepared.set(raw, prepareEdition(raw));
  return prepared.get(raw);
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

/** Validate archive query parameters; anything unrecognized is simply ignored. */
function parseArchiveQuery(query) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const strangeness = Number(str(query.strangeness));
  const page = Number(str(query.page));
  const sort = str(query.sort);
  const month = str(query.month);
  return {
    q: str(query.q).slice(0, 100),
    section: sectionBySlug(str(query.section)),
    strangeness: Number.isInteger(strangeness) && strangeness >= 1 && strangeness <= 5 ? strangeness : null,
    source: str(query.source).slice(0, 200) || null,
    month: /^\d{4}-\d{2}$/.test(month) ? month : null,
    sort: SORTS[sort] ? sort : 'newest',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
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
    const articles = (await articleIndex()).filter((a) => a.section === id).slice(0, 60);
    sendHtml(res, sectionPage(ctx, id, articles));
  });
  // Section ids from older links (e.g. /section/skies) -> keyword slug
  router.get('/section/:id', (req, res, next) => (SECTIONS[req.params.id] ? res.redirect(301, sectionPath(req.params.id)) : next()));

  router.get('/archive', async (req, res) => {
    const filters = parseArchiveQuery(req.query);
    const [ctx, all] = await Promise.all([context(req), articleIndex()]);
    const matches = filterArticles(all, filters);
    const pages = Math.max(1, Math.ceil(matches.length / ARCHIVE_PAGE_SIZE));
    if (filters.page > pages) return res.redirect(302, archiveUrl({ ...filters, page: pages }));
    const results = matches.slice((filters.page - 1) * ARCHIVE_PAGE_SIZE, filters.page * ARCHIVE_PAGE_SIZE);
    sendHtml(
      res,
      archivePage(ctx, { results, total: matches.length, totalAll: all.length, filters, page: filters.page, pages, facets: facets(all), sorts: SORTS }),
    );
  });
  router.get('/about', async (req, res) => sendHtml(res, aboutPage(await context(req))));

  router.get('/robots.txt', (req, res) => res.set('Cache-Control', FEED_CACHE).type('text/plain').send(robotsTxt(siteOrigin(req))));

  router.get('/sitemap.xml', async (req, res) => {
    sendXml(res, sitemapXml(siteOrigin(req), await listEditions(), await articleIndex()));
  });

  router.get('/news-sitemap.xml', async (req, res) => sendXml(res, newsSitemapXml(siteOrigin(req), await articleIndex())));

  router.get('/feed.xml', async (req, res) => sendXml(res, rssXml(siteOrigin(req), await articleIndex()), 'application/rss+xml'));

  return router;
}

/** Last stop for GET requests: a real 404 page (with a 404 status, so it never gets indexed). */
export async function notFound(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(404).end();
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  sendHtml(res, notFoundPage(await context(req)), 404);
}
