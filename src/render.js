// Server-side HTML for the public site. Every interpolated value is HTML-escaped unless wrapped in raw(),
// because most of what we print (headlines, source titles, image URLs) comes from scraped pages.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config, loadSources, ROOT } from './config.js';
import { SITE, SECTIONS, sectionPath, editionPath } from './site.js';

// ---------------------------------------------------------------- Templating

class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
export const raw = (s) => new Raw(String(s));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);

function interpolate(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(interpolate).join('');
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => (out += interpolate(v) + strings[i + 1]));
  return new Raw(out);
}

/** JSON-LD block; "<" is escaped so scraped text can never close the script tag. */
const jsonLd = (data) =>
  raw(`<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', ...data }).replace(/</g, '\\u003c')}</script>`);

const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

// ---------------------------------------------------------------- Formatting

const longDate = (date) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
const shortDate = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const monthName = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const printedAt = (iso) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: config.timezone });
const publishedOn = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null);

function roman(n) {
  const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) (out += s), (n -= v);
  return out || 'I';
}

/** Trim to a meta-description-sized sentence. */
export function clip(text, max = 155) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > max * 0.6 ? cut.lastIndexOf(' ') : cut.length).replace(/[,;:.\s]+$/, '')}…`;
}

const sectionName = (id) => SECTIONS[id]?.name ?? id;
const isForum = (url) => /(^|\.)(reddit\.com|4chan\.org|4channel\.org)\//i.test(String(url).replace(/^https?:\/\//, ''));
const outRel = (url) => (isForum(url) ? 'nofollow ugc noopener' : 'nofollow noopener');

// ---------------------------------------------------------------- Page shell

// Hostinger's CDN caches static files, so stylesheet and script URLs carry a content hash:
// a deploy that changes them changes the URL, and nobody gets a stale copy.
function asset(name) {
  try {
    const hash = createHash('md5').update(fs.readFileSync(path.join(ROOT, 'public', name))).digest('hex').slice(0, 10);
    return `/${name}?v=${hash}`;
  } catch {
    return `/${name}`;
  }
}
const ASSETS = { css: asset('style.css'), js: asset('app.js') };

const GA_TAG = raw(`<!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-Y2X25QZMV0"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());

    gtag('config', 'G-Y2X25QZMV0');
  </script>`);

const ROBOTS_INDEX = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
const ROBOTS_NOINDEX = 'noindex, follow';

function layout({ ctx, path, title, description, image, type = 'website', noindex = false, article, jsonld, header, main }) {
  const url = ctx.origin + path;
  const img = safeUrl(image) || `${ctx.origin}/og-default.png`;
  return html`<!doctype html>
<html lang="${SITE.language}">
<head>
  ${GA_TAG}
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta name="robots" content="${noindex ? ROBOTS_NOINDEX : ROBOTS_INDEX}">
  ${noindex ? '' : html`<link rel="canonical" href="${url}">`}
  <meta property="og:site_name" content="${SITE.name}">
  <meta property="og:locale" content="${SITE.locale}">
  <meta property="og:type" content="${type}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${img}">
  ${article
    ? html`<meta property="article:published_time" content="${article.published}">
  <meta property="article:modified_time" content="${article.published}">
  <meta property="article:section" content="${article.section}">`
    : ''}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${img}">
  <meta name="theme-color" content="#f3ecdc" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#17150f" media="(prefers-color-scheme: dark)">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="alternate" type="application/rss+xml" title="${SITE.name}" href="${ctx.origin}/feed.xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=UnifrakturMaguntia&family=Playfair+Display:ital,wght@0,600;0,800;0,900;1,500&family=Libre+Caslon+Text:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="${ASSETS.css}">
  <script>try{var t=localStorage.getItem('paranews-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
  ${jsonld ? jsonLd(jsonld) : ''}
</head>
<body>
  <div class="paper">
    ${header}
    <main id="main">
${main}
    </main>
    ${footer(ctx)}
  </div>
  <script src="${ASSETS.js}" defer></script>
</body>
</html>
`;
}

function masthead(ctx, { edition = ctx.latest, h1 = null, activeSection = null, isFront = false, isArchive = false } = {}) {
  const shown = edition || ctx.latest;
  const title = h1 ? html`<h1 class="title">${SITE.name}${h1 === true ? '' : html`<span class="visually-hidden">${h1}</span>`}</h1>` : html`<a class="title" href="/">${SITE.name}</a>`;
  return html`<header class="masthead">
      <div class="folio">
        <span>${shown ? `Vol. ${roman(shown.volume || 1)} · No. ${shown.issue}` : 'Vol. I'}</span>
        ${shown ? html`<time datetime="${shown.date}">${longDate(shown.date)}</time>` : html`<span>&nbsp;</span>`}
        <span>Price: One Tinfoil Hat</span>
      </div>
      <div class="banner">
        <aside class="ear ear-left">
          <p class="ear-title">Weather</p>
          <p>${shown?.weather || 'Clear, with a chance of the unexplained.'}</p>
        </aside>
        ${title}
        <aside class="ear ear-right">
          <p class="ear-title">Omen of the Day</p>
          <p>${shown?.omen || 'Something is about to happen.'}</p>
        </aside>
      </div>
      <p class="motto">“${SITE.tagline}”</p>
      <nav class="toolbar" aria-label="Sections">
        <div class="sections">
          <a href="/"${isFront ? raw(' aria-current="page"') : ''}>Front Page</a>
          ${Object.keys(SECTIONS).map((id) => html`<a href="${sectionPath(id)}"${activeSection === id ? raw(' aria-current="page"') : ''}>${SECTIONS[id].name}</a>`)}
        </div>
        <div class="tools">
          <label class="archive">
            <span>Edition</span>
            <select id="edition-select">
              ${ctx.editions.map((e) => html`<option value="${editionPath(e.date)}"${shown && e.date === shown.date ? raw(' selected') : ''}>${shortDate(e.date)} · No. ${e.issue}</option>`)}
            </select>
          </label>
          <a class="archive-btn" href="/archive"${isArchive ? raw(' aria-current="page"') : ''}>Archive</a>
          <button type="button" id="theme-toggle" title="Toggle night edition" aria-label="Toggle night edition">☾</button>
        </div>
      </nav>
    </header>`;
}

function footer(ctx) {
  return html`<footer class="colophon">
      <nav class="footer-nav" aria-label="Site">
        <a href="/">Front Page</a>
        <a href="/archive">Archive</a>
        <a href="/about">About &amp; Editorial Standards</a>
        <a href="/feed.xml">RSS Feed</a>
      </nav>
      <p class="fine">© ${new Date().getFullYear()} ${SITE.name}. Stories are written by AI from public sources and report their claims without endorsing them. Every story links to its original.</p>
    </footer>`;
}

// ---------------------------------------------------------------- Article pieces

function meter(level) {
  if (!level) return '';
  return html`<div class="meter" title="Strangeness ${level} of 5">Strangeness <span class="eyes" aria-hidden="true">${'◉'.repeat(level)}${'○'.repeat(5 - level)}</span><span class="visually-hidden">${level} of 5</span></div>`;
}

function figure(a, { priority = false, link = null } = {}) {
  const src = safeUrl(a.image);
  if (!src) return '';
  const img = html`<img src="${src}" alt="${a.headline}" width="1200" height="750" decoding="async" referrerpolicy="no-referrer" ${raw(priority ? 'fetchpriority="high"' : 'loading="lazy"')} onerror="this.closest('figure').remove()">`;
  return html`<figure>
          ${link ? html`<a href="${link}" tabindex="-1" aria-hidden="true">${img}</a>` : img}
          <figcaption>Image: ${a.original.origin || a.original.source}</figcaption>
        </figure>`;
}

function paragraphs(a, count = a.paragraphs.length) {
  return a.paragraphs.slice(0, count).map(
    (p, i) => html`<p>${i === 0 && a.dateline ? html`<span class="dateline">${a.dateline.toUpperCase()} — </span>` : ''}${p}</p>`,
  );
}

function provenance(o) {
  const when = publishedOn(o.published);
  return html`<div class="provenance">
          Source: ${o.origin || (safeUrl(o.sourceHomepage) ? html`<a href="${o.sourceHomepage}" rel="${outRel(o.sourceHomepage)}" target="_blank">${o.source}</a>` : o.source)}${o.via ? html` · found via ${safeUrl(o.sourceHomepage) ? html`<a href="${o.sourceHomepage}" rel="nofollow noopener" target="_blank">${o.via}</a>` : o.via}` : ''}${when ? ` · ${when}` : ''}<br>
          ${safeUrl(o.url) ? html`<a class="original" href="${o.url}" rel="${outRel(o.url)}" target="_blank">Read the original post →</a>` : ''}
        </div>`;
}

/** An article as it appears on a front page: excerpt plus a link to its own page. */
function card(a, { lead = false, excerpt = 2, priority = false } = {}) {
  const H = lead ? 'h2' : 'h3';
  const more = a.paragraphs.length > excerpt;
  return html`<article class="article${lead ? ' lead' : ''}${a.aiWritten ? '' : ' wire'}">
        ${a.kicker ? html`<p class="kicker">${a.kicker}</p>` : ''}
        ${raw(`<${H} class="headline">`)}<a class="headline-link" href="${a.path}">${a.headline}</a>${raw(`</${H}>`)}
        ${a.deck ? html`<p class="deck">${a.deck}</p>` : ''}
        ${meter(a.weirdness)}
        ${figure(a, { priority, link: a.path })}
        <div class="body">${paragraphs(a, excerpt)}</div>
        <p class="continue-row"><a class="continue" href="${a.path}">${more ? 'Continue reading' : 'Read the story'}<span class="visually-hidden">: ${a.headline}</span> ›</a></p>
        ${provenance(a.original)}
      </article>`;
}

function briefsColumn(briefs) {
  if (!briefs?.length) return '';
  return html`<aside class="briefs" aria-labelledby="briefs-title">
        <h2 id="briefs-title" class="column-title">In Brief</h2>
        <ol>
          ${briefs.map(
            (b) => html`<li>${b.blurb}<span class="brief-source">${b.source}${safeUrl(b.url) ? html` · <a href="${b.url}" rel="${outRel(b.url)}" target="_blank">original →</a>` : ''}</span></li>`,
          )}
        </ol>
      </aside>`;
}

// ---------------------------------------------------------------- Structured data

const orgId = (ctx) => `${ctx.origin}/#organization`;
const siteId = (ctx) => `${ctx.origin}/#website`;

function organization(ctx) {
  return {
    '@type': 'NewsMediaOrganization',
    '@id': orgId(ctx),
    name: SITE.name,
    url: `${ctx.origin}/`,
    logo: { '@type': 'ImageObject', url: `${ctx.origin}/logo.png`, width: 512, height: 512 },
    description: SITE.description,
    publishingPrinciples: `${ctx.origin}/about`,
    ethicsPolicy: `${ctx.origin}/about#standards`,
  };
}

function website(ctx) {
  return { '@type': 'WebSite', '@id': siteId(ctx), url: `${ctx.origin}/`, name: SITE.name, description: SITE.description, inLanguage: SITE.language, publisher: { '@id': orgId(ctx) } };
}

function breadcrumbs(ctx, trail) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: ctx.origin + path })),
  };
}

function itemList(ctx, articles) {
  return {
    '@type': 'ItemList',
    itemListElement: articles.map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: ctx.origin + a.path, name: a.headline })),
  };
}

function collectionPage(ctx, path, name, description, articles) {
  return {
    '@type': 'CollectionPage',
    '@id': `${ctx.origin}${path}#page`,
    url: ctx.origin + path,
    name,
    description,
    inLanguage: SITE.language,
    isPartOf: { '@id': siteId(ctx) },
    publisher: { '@id': orgId(ctx) },
    ...(articles?.length ? { mainEntity: itemList(ctx, articles) } : {}),
  };
}

function newsArticle(ctx, edition, a) {
  const url = ctx.origin + a.path;
  const words = a.paragraphs.join(' ').split(/\s+/).length;
  return {
    '@type': 'NewsArticle',
    '@id': `${url}#article`,
    mainEntityOfPage: url,
    url,
    headline: clip(a.headline, 110),
    description: clip(a.deck || a.paragraphs[0] || a.headline, 300),
    ...(safeUrl(a.image) ? { image: [a.image] } : { image: [`${ctx.origin}/og-default.png`] }),
    datePublished: edition.generatedAt,
    dateModified: edition.generatedAt,
    articleSection: sectionName(a.section),
    inLanguage: SITE.language,
    wordCount: words,
    isAccessibleForFree: true,
    author: { '@type': 'Organization', name: `${SITE.name} Desk`, url: `${ctx.origin}/about` },
    publisher: { '@id': orgId(ctx) },
    isPartOf: { '@id': siteId(ctx) },
    ...(safeUrl(a.original.url)
      ? {
          isBasedOn: {
            '@type': 'CreativeWork',
            name: a.original.title,
            url: a.original.url,
            ...(a.original.origin || a.original.source ? { publisher: { '@type': 'Organization', name: a.original.origin || a.original.source } } : {}),
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------- Pages

function editionMain(edition) {
  const lead = edition.articles.find((a) => a.lead) || edition.articles[0];
  const blocks = Object.keys(SECTIONS)
    .map((id) => [id, edition.articles.filter((a) => a.section === id && a !== lead)])
    .filter(([, items]) => items.length);
  const ok = (edition.sourceReport || []).filter((s) => s.ok).length;
  return html`
      <div class="front-top">
        <div class="lead">${card(lead, { lead: true, excerpt: 4, priority: true })}</div>
        ${briefsColumn(edition.briefs)}
      </div>
      ${blocks.map(
        ([id, items]) => html`<section class="section-block" aria-labelledby="sec-${id}">
        <div class="section-banner"><h2 id="sec-${id}"><a href="${sectionPath(id)}">${sectionName(id)}</a><small>${items.length} ${items.length === 1 ? 'report' : 'reports'}</small></h2></div>
        <div class="columns">
      ${items.map((a) => card(a))}
        </div>
      </section>`,
      )}
      <div class="edition-meta">
        <p>Printed ${printedAt(edition.generatedAt)} · ${ok} of ${(edition.sourceReport || []).length} correspondents answered · ${edition.stats?.candidates ?? '—'} items on the wire${edition.ai?.used ? ` · written by ${edition.ai.model}` : ''}</p>
        ${edition.sourceReport?.length
          ? html`<details>
          <summary>Correspondents consulted for this edition</summary>
          <ul class="source-list">${edition.sourceReport.map((s) => html`<li class="${s.ok ? '' : 'bad'}">${s.ok ? '✓' : '✗'} ${correspondentLink(s)}</li>`)}</ul>
        </details>`
          : ''}
      </div>`;
}

/** A correspondent from an edition's source report, linked to its homepage when we know it. */
let homepages;
function correspondentLink(report) {
  homepages ||= new Map(loadSources({ includeDisabled: true }).sources.map((s) => [s.id, s.homepage]));
  const homepage = homepages.get(report.id);
  return safeUrl(homepage) ? html`<a href="${homepage}" rel="nofollow noopener" target="_blank">${report.name}</a>` : report.name;
}

function editionPager(ctx, date) {
  const i = ctx.editions.findIndex((e) => e.date === date);
  const newer = i > 0 ? ctx.editions[i - 1] : null;
  const older = i >= 0 && i < ctx.editions.length - 1 ? ctx.editions[i + 1] : null;
  if (!newer && !older) return '';
  return html`<nav class="pager" aria-label="Editions">
        ${older ? html`<a rel="prev" href="${editionPath(older.date)}">‹ ${longDate(older.date)}</a>` : html`<span></span>`}
        ${newer ? html`<a rel="next" href="${editionPath(newer.date)}">${longDate(newer.date)} ›</a>` : html`<span></span>`}
      </nav>`;
}

export function frontPage(ctx, edition) {
  const lead = edition.articles.find((a) => a.lead) || edition.articles[0];
  return layout({
    ctx,
    path: '/',
    title: SITE.homeTitle,
    description: clip(`Today in ${SITE.name}: ${lead.headline}. ${SITE.description}`),
    image: lead.image,
    jsonld: {
      '@graph': [organization(ctx), website(ctx), collectionPage(ctx, '/', SITE.homeTitle, SITE.description, edition.articles)],
    },
    header: masthead(ctx, { edition, h1: true, isFront: true }),
    main: html`${editionMain(edition)}
      ${editionPager(ctx, edition.date)}`,
  });
}

export function editionPage(ctx, edition) {
  const lead = edition.articles.find((a) => a.lead) || edition.articles[0];
  const title = `${longDate(edition.date)} Edition — ${SITE.name}`;
  const description = clip(`${SITE.name} No. ${edition.issue}, ${longDate(edition.date)}: ${edition.articles.slice(0, 3).map((a) => a.headline).join(' · ')}`);
  return layout({
    ctx,
    path: edition.path,
    title,
    description,
    image: lead.image,
    jsonld: {
      '@graph': [
        collectionPage(ctx, edition.path, title, description, edition.articles),
        breadcrumbs(ctx, [['Front Page', '/'], ['Archive', '/archive'], [`${shortDate(edition.date)} Edition`, edition.path]]),
      ],
    },
    header: masthead(ctx, { edition, h1: `, edition of ${longDate(edition.date)}` }),
    main: html`${editionMain(edition)}
      ${editionPager(ctx, edition.date)}`,
  });
}

export function articlePage(ctx, edition, a) {
  const section = sectionName(a.section);
  const o = a.original;
  const related = [...edition.articles.filter((x) => x !== a && x.section === a.section), ...edition.articles.filter((x) => x !== a && x.section !== a.section)].slice(0, 8);
  const trail = [['Front Page', '/'], [`${shortDate(edition.date)} Edition`, edition.path], [section, sectionPath(a.section)]];
  const when = publishedOn(o.published);
  return layout({
    ctx,
    path: a.path,
    title: `${a.headline} | ${SITE.name}`,
    description: clip(a.deck || a.paragraphs[0] || a.headline),
    image: a.image,
    type: 'article',
    article: { published: edition.generatedAt, section },
    jsonld: { '@graph': [newsArticle(ctx, edition, a), breadcrumbs(ctx, [...trail, [a.headline, a.path]])] },
    header: masthead(ctx, { edition, activeSection: a.section }),
    main: html`
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <ol>${trail.map(([name, path]) => html`<li><a href="${path}">${name}</a></li>`)}</ol>
      </nav>
      <article class="story${a.aiWritten ? '' : ' wire'}">
        <header class="story-head">
          ${a.kicker ? html`<p class="kicker">${a.kicker}</p>` : ''}
          <h1 class="headline">${a.headline}</h1>
          ${a.deck ? html`<p class="deck">${a.deck}</p>` : ''}
          <p class="byline">By the ${SITE.name} Desk · <time datetime="${edition.generatedAt}">${longDate(edition.date)}</time> · <a href="${sectionPath(a.section)}">${section}</a></p>
          ${meter(a.weirdness)}
        </header>
        ${figure(a, { priority: true })}
        <div class="body story-body">${paragraphs(a)}</div>
        <aside class="source-box" aria-labelledby="source-title">
          <h2 id="source-title">Where This Story Comes From</h2>
          <p>This report is based on “${o.title}” ${o.origin ? html`from ${o.origin}, found via ${o.via}` : html`from ${o.source}`}${when ? `, published ${when}` : ''}.</p>
          ${safeUrl(o.url) ? html`<p><a class="original" href="${o.url}" rel="${outRel(o.url)}" target="_blank">Read the original post →</a></p>` : ''}
          <p class="fine">${a.aiWritten
            ? html`Written by ${SITE.name}’s AI desk from the source above. Claims are the source’s own; we report them, we don’t vouch for them.`
            : 'Unedited wire copy: an excerpt of the source above.'} <a href="/about#standards">Our editorial standards</a>.</p>
        </aside>
      </article>
      ${related.length
        ? html`<section class="more" aria-labelledby="more-title">
        <h2 id="more-title" class="column-title">More from the ${longDate(edition.date)} Edition</h2>
        <ul class="more-list">
          ${related.map((r) => html`<li><a href="${r.path}">${r.headline}</a><span class="more-section">${sectionName(r.section)}</span></li>`)}
        </ul>
      </section>`
        : ''}
      ${editionPager(ctx, edition.date)}`,
  });
}

/** One story in a listing (section pages): takes an entry from the article index. */
function listingCard(a) {
  return html`<article class="article listing-card">
          <p class="kicker"><time datetime="${a.date}">${shortDate(a.date)}</time>${a.kicker ? ` · ${a.kicker}` : ''}</p>
          <h2 class="headline"><a class="headline-link" href="${a.path}">${a.headline}</a></h2>
          ${a.deck ? html`<p class="deck">${a.deck}</p>` : ''}
          ${figure(a, { link: a.path })}
          <div class="body"><p>${a.dateline ? html`<span class="dateline">${a.dateline.toUpperCase()} — </span>` : ''}${a.excerpt}</p></div>
          <p class="continue-row"><a class="continue" href="${a.path}">Read the story<span class="visually-hidden">: ${a.headline}</span> ›</a></p>
        </article>`;
}

export function sectionPage(ctx, id, articles) {
  const s = SECTIONS[id];
  const path = sectionPath(id);
  const title = `${s.topic} — ${s.name} | ${SITE.name}`;
  return layout({
    ctx,
    path,
    title,
    description: s.description,
    image: articles.find((a) => a.image)?.image,
    jsonld: { '@graph': [collectionPage(ctx, path, title, s.description, articles), breadcrumbs(ctx, [['Front Page', '/'], [s.name, path]])] },
    header: masthead(ctx, { activeSection: id }),
    main: html`
      <header class="page-head">
        <p class="kicker">${s.name}</p>
        <h1>${s.topic}</h1>
        <p class="deck">${s.description}</p>
      </header>
      ${articles.length
        ? html`<div class="columns listing">
        ${articles.map(listingCard)}
      </div>
      <p class="continue-row centered"><a class="continue" href="${archiveUrl({ section: id })}">Every ${s.name} story in the archive ›</a></p>`
        : html`<p class="empty-note">No reports in this section yet. The presses run every morning.</p>`}`,
  });
}

// ---------------------------------------------------------------- Archive

const STRANGENESS = [
  [2, '◉◉ and stranger'],
  [3, '◉◉◉ and stranger'],
  [4, '◉◉◉◉ and stranger'],
  [5, '◉◉◉◉◉ only'],
];

/** /archive URL for a set of filters (section by id, page numbers from 2 up). */
export function archiveUrl({ q, section, strangeness, source, month, sort, page } = {}) {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (section) p.set('section', SECTIONS[section]?.slug ?? section);
  if (strangeness) p.set('strangeness', String(strangeness));
  if (source) p.set('source', source);
  if (month) p.set('month', month);
  if (sort && sort !== 'newest') p.set('sort', sort);
  if (page && page > 1) p.set('page', String(page));
  const qs = p.toString();
  return qs ? `/archive?${qs}` : '/archive';
}

const option = (value, label, current) =>
  html`<option value="${value}"${String(current ?? '') === String(value) ? raw(' selected') : ''}>${label}</option>`;

function archiveFilters(filters, facetList, sorts) {
  const sectionSlug = filters.section ? SECTIONS[filters.section].slug : '';
  const active = archiveUrl({ ...filters, page: 1 }) !== '/archive';
  return html`<form class="filters" method="get" action="/archive" role="search" aria-label="Filter the archive">
          <label class="filter filter-search">
            <span>Search</span>
            <input type="search" name="q" value="${filters.q || ''}" placeholder="Mothman, orbs, Grusch…" maxlength="100">
          </label>
          <label class="filter">
            <span>Strangeness</span>
            <select name="strangeness">
              ${option('', 'Any strangeness', filters.strangeness)}
              ${STRANGENESS.map(([v, label]) => option(v, `${label} (${facetList.strangeness[v]})`, filters.strangeness))}
            </select>
          </label>
          <label class="filter">
            <span>Section</span>
            <select name="section">
              ${option('', 'All sections', sectionSlug)}
              ${Object.values(SECTIONS).map((s) => option(s.slug, s.name, sectionSlug))}
            </select>
          </label>
          <label class="filter">
            <span>Source</span>
            <select name="source">
              ${option('', 'All sources', filters.source)}
              ${facetList.sources.map(([name, count]) => option(name, `${name} (${count})`, filters.source))}
            </select>
          </label>
          <label class="filter">
            <span>Month</span>
            <select name="month">
              ${option('', 'All months', filters.month)}
              ${facetList.months.map((m) => option(m, monthName(`${m}-01`), filters.month))}
            </select>
          </label>
          <label class="filter">
            <span>Order</span>
            <select name="sort">
              ${Object.entries(sorts).map(([v, label]) => option(v, label, filters.sort || 'newest'))}
            </select>
          </label>
          <div class="filter-actions">
            <button type="submit" class="btn-primary">Search the Archive</button>
            ${active ? html`<a class="reset" href="/archive">Clear filters</a>` : ''}
          </div>
        </form>`;
}

function archiveResult(a) {
  const img = safeUrl(a.image);
  return html`<li class="result${img ? ' has-thumb' : ''}">
            ${img
              ? html`<a class="thumb" href="${a.path}" tabindex="-1" aria-hidden="true"><img src="${img}" alt="" width="160" height="107" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></a>`
              : ''}
            <p class="kicker"><time datetime="${a.date}">${shortDate(a.date)}</time> · <a href="${sectionPath(a.section)}">${sectionName(a.section)}</a></p>
            <h2 class="result-headline"><a href="${a.path}">${a.headline}</a></h2>
            ${a.deck ? html`<p class="deck">${a.deck}</p>` : ''}
            <p class="result-meta">${a.weirdness
              ? html`<span class="eyes" title="Strangeness ${a.weirdness} of 5">${'◉'.repeat(a.weirdness)}${'○'.repeat(5 - a.weirdness)}</span><span class="visually-hidden">Strangeness ${a.weirdness} of 5</span> · `
              : ''}${a.source}</p>
          </li>`;
}

function archivePager(filters, page, pages) {
  if (pages <= 1) return '';
  const nums = [...new Set([1, page - 2, page - 1, page, page + 1, page + 2, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const items = [];
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) items.push(html`<span class="gap">…</span>`);
    items.push(n === page ? html`<span aria-current="page">${n}</span>` : html`<a href="${archiveUrl({ ...filters, page: n })}">${n}</a>`);
  });
  return html`<nav class="archive-pager" aria-label="Archive pages">
          ${page > 1 ? html`<a rel="prev" href="${archiveUrl({ ...filters, page: page - 1 })}">‹ Previous</a>` : ''}
          ${items}
          ${page < pages ? html`<a rel="next" href="${archiveUrl({ ...filters, page: page + 1 })}">Next ›</a>` : ''}
        </nav>`;
}

function backIssues(editions) {
  const byMonth = new Map();
  for (const e of editions) {
    const key = monthName(e.date);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(e);
  }
  return html`<aside class="back-issues" aria-labelledby="back-issues-title">
        <h2 id="back-issues-title" class="column-title">Back Issues</h2>
        ${[...byMonth].map(
          ([month, list]) => html`<h3 class="back-month">${month}</h3>
        <ol class="archive-list">
          ${list.map(
            (e) => html`<li>
            <a href="${editionPath(e.date)}"><time datetime="${e.date}">${shortDate(e.date)}</time> · No. ${e.issue}</a>
            ${e.lead ? html`<span class="archive-lead">${e.lead}</span>` : ''}
          </li>`,
          )}
        </ol>`,
        )}
      </aside>`;
}

/**
 * view: { results (this page), total (matches), totalAll (whole archive), filters, page, pages, facets, sorts }
 * Filtered or paged views are noindex: the plain /archive page is the one we want in search results.
 */
export function archivePage(ctx, view) {
  const { results, total, totalAll, filters, page, pages } = view;
  const filtered = archiveUrl(filters) !== '/archive';
  const description = `Search every story ${SITE.name} has printed (${totalAll} so far) by strangeness, section, source or month: UFOs, ghosts, cryptids and high strangeness.`;
  const countLine = archiveUrl({ ...filters, page: 1 }) !== '/archive'
    ? `${total} ${total === 1 ? 'story matches' : 'stories match'}${pages > 1 ? ` · page ${page} of ${pages}` : ''}`
    : `${totalAll} stories in ${ctx.editions.length} editions${pages > 1 ? ` · page ${page} of ${pages}` : ''}`;
  return layout({
    ctx,
    path: archiveUrl(filters),
    title: filtered ? `Archive search${filters.q ? `: ${filters.q}` : ''} | ${SITE.name}` : `The Archive: Every Story | ${SITE.name}`,
    description,
    noindex: filtered,
    jsonld: filtered
      ? null
      : {
          '@graph': [
            collectionPage(ctx, '/archive', `The Archive — ${SITE.name}`, description, results),
            breadcrumbs(ctx, [['Front Page', '/'], ['Archive', '/archive']]),
          ],
        },
    header: masthead(ctx, { isArchive: true }),
    main: html`
      <header class="page-head">
        <p class="kicker">The Morgue</p>
        <h1>The Archive</h1>
        <p class="deck">Every story we have printed, from the merely odd to the frankly impossible. Filter by strangeness, section, source or month.</p>
      </header>
      <div class="archive-layout">
        <div class="archive-main">
        ${archiveFilters(filters, view.facets, view.sorts)}
        <p class="result-count" role="status">${countLine}</p>
        ${results.length
          ? html`<ol class="results">
          ${results.map(archiveResult)}
        </ol>`
          : html`<p class="empty-note">Nothing in the archive matches that. The truth may be out there, but not here.</p>`}
        ${archivePager(filters, page, pages)}
        </div>
        ${backIssues(ctx.editions)}
      </div>`,
  });
}

export function aboutPage(ctx) {
  const { sources } = loadSources();
  const bySection = Object.keys(SECTIONS)
    .map((id) => [id, sources.filter((s) => s.section === id)])
    .filter(([, list]) => list.length);
  const description = `How ${SITE.name} is made: a daily paper of paranormal and high-strangeness news, gathered from ${sources.length} sources and written by AI with every story linked to its original.`;
  return layout({
    ctx,
    path: '/about',
    title: `About ${SITE.name} & Our Editorial Standards`,
    description,
    jsonld: {
      '@graph': [
        { '@type': 'AboutPage', '@id': `${ctx.origin}/about#page`, url: `${ctx.origin}/about`, name: `About ${SITE.name}`, description, isPartOf: { '@id': siteId(ctx) }, about: { '@id': orgId(ctx) } },
        organization(ctx),
        breadcrumbs(ctx, [['Front Page', '/'], ['About', '/about']]),
      ],
    },
    header: masthead(ctx),
    main: html`
      <article class="prose">
        <header class="page-head">
          <p class="kicker">About the Paper</p>
          <h1>About ${SITE.name}</h1>
          <p class="deck">${SITE.description}</p>
        </header>

        <h2>What we print</h2>
        <p>Every morning ${SITE.name} reads the strangest corners of the internet: UFO and UAP blogs, ghost and cryptid reporters, channeled messages from star beings, synchromystic decoders, ancient-mystery sites, the weird-news wires and the paranormal boards of Reddit and 4chan. The most remarkable reports become the day’s edition, written up in the voice of an old-fashioned broadsheet that keeps a perfectly straight face.</p>

        <h2>How an edition is made</h2>
        <ol>
          <li>At dawn we collect everything our ${sources.length} correspondents have published in the last day and a half.</li>
          <li>An AI editor (Anthropic’s Claude) reads the whole wire and picks the strangest, most substantial stories, plus a column of briefs.</li>
          <li>For each story, Claude reads the full original and writes a short news article from it.</li>
          <li>The edition is printed, and the previous day’s paper moves to the <a href="/archive">archive</a>.</li>
        </ol>

        <h2 id="standards">Editorial standards</h2>
        <ul>
          <li><strong>Claims are reported, not endorsed.</strong> Every claim is attributed to the person or site making it. Nothing paranormal is ever stated as fact, and where a source offers a mundane explanation we say so.</li>
          <li><strong>Every story names and links its source.</strong> Each article ends with where it came from and a link to the original post, so you can judge it for yourself.</li>
          <li><strong>No invented facts.</strong> Writers may only use names, places, dates and quotes that appear in the source; quotes must be verbatim.</li>
          <li><strong>Privacy.</strong> We never print the usernames of forum posters, and we leave out posts that single out private individuals or read as someone’s real crisis.</li>
          <li><strong>Written by AI.</strong> The articles, briefs, weather and omens are written by Claude, an AI model, following these rules. Mistakes are possible; the original source is always one click away.</li>
        </ul>

        <h2>Our correspondents</h2>
        ${bySection.map(
          ([id, list]) => html`<h3><a href="${sectionPath(id)}">${SECTIONS[id].name}</a></h3>
        <ul class="correspondents">
          ${list.map((s) => html`<li>${safeUrl(s.homepage) ? html`<a href="${s.homepage}" rel="nofollow noopener" target="_blank">${s.name}</a>` : s.name}</li>`)}
        </ul>`,
        )}
      </article>`,
  });
}

export function notFoundPage(ctx) {
  return layout({
    ctx,
    path: '/404',
    title: `Page Not Found | ${SITE.name}`,
    description: 'This page has vanished without a trace.',
    noindex: true,
    header: masthead(ctx),
    main: html`
      <section class="empty">
        <h1>Vanished Without a Trace</h1>
        <p>Witnesses report this page was here a moment ago. Investigators found only a faint smell of ozone.</p>
        <p><a class="continue" href="/">Return to the front page ›</a> · <a class="continue" href="/archive">Search the archive ›</a></p>
      </section>`,
  });
}

export function emptyPage(ctx) {
  return layout({
    ctx,
    path: '/',
    title: SITE.homeTitle,
    description: SITE.description,
    noindex: true,
    header: masthead(ctx, { h1: true, isFront: true }),
    main: html`
      <section class="empty">
        <h2>The Presses Have Not Yet Run</h2>
        <p>The first edition is on its way. Check back in a few minutes.</p>
      </section>`,
  });
}
