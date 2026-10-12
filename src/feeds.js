// robots.txt, XML sitemaps (regular + Google News) and the RSS feed.
import { SITE, SECTIONS, sectionPath, editionPath } from './site.js';
import { clip } from './render.js';

const XML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const x = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => XML_ESC[c]);
// Strip characters XML 1.0 forbids (scraped text occasionally carries control characters).
const clean = (v) => x(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export function robotsTxt(origin) {
  return `User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${origin}/sitemap.xml
Sitemap: ${origin}/news-sitemap.xml
`;
}

/** editions: edition summaries, newest first; articles: entries from the article index. */
export function sitemapXml(origin, editions, articles) {
  const latest = editions[0]?.generatedAt;
  const url = (path, lastmod, changefreq, priority) =>
    `  <url><loc>${x(origin + path)}</loc>${lastmod ? `<lastmod>${x(lastmod)}</lastmod>` : ''}<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
  const lines = [
    url('/', latest, 'daily', '1.0'),
    url('/archive', latest, 'daily', '0.6'),
    url('/about', null, 'monthly', '0.4'),
    ...Object.keys(SECTIONS).map((id) => url(sectionPath(id), latest, 'daily', '0.7')),
  ];
  for (const e of editions) lines.push(url(editionPath(e.date), e.generatedAt, 'monthly', '0.6'));
  for (const a of articles) lines.push(url(a.path, a.generatedAt, 'monthly', a.lead ? '0.8' : '0.7'));
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${lines.join('\n')}
</urlset>
`;
}

/** Google News sitemap: only articles from the last two days, as Google asks. */
export function newsSitemapXml(origin, articles) {
  const cutoff = Date.now() - 48 * 3600e3;
  const entries = articles
    .filter((a) => new Date(a.generatedAt).getTime() >= cutoff)
    .map(
        (a) => `  <url>
    <loc>${x(origin + a.path)}</loc>
    <news:news>
      <news:publication><news:name>${x(SITE.name)}</news:name><news:language>${SITE.language}</news:language></news:publication>
      <news:publication_date>${x(a.generatedAt)}</news:publication_date>
      <news:title>${clean(a.headline)}</news:title>
    </news:news>
  </url>`,
    );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${entries.join('\n')}
</urlset>
`;
}

/** RSS 2.0 feed of the most recent articles. */
export function rssXml(origin, articles, limit = 50) {
  const items = articles
    .slice(0, limit)
    .map((a) => {
      const link = origin + a.path;
      const ext = /\.(png|webp|gif)(\?|$)/i.exec(a.image || '')?.[1]?.toLowerCase();
      const image = /^https?:\/\//.test(a.image || '') ? `\n      <enclosure url="${x(a.image)}" type="image/${ext || 'jpeg'}" length="0"/>` : '';
      return `    <item>
      <title>${clean(a.headline)}</title>
      <link>${x(link)}</link>
      <guid isPermaLink="true">${x(link)}</guid>
      <pubDate>${new Date(a.generatedAt).toUTCString()}</pubDate>
      <category>${x(SECTIONS[a.section]?.name ?? a.section)}</category>
      <description>${clean(clip(a.deck || a.excerpt || '', 300))}</description>${image}
    </item>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${x(SITE.name)}</title>
    <link>${x(origin)}/</link>
    <description>${x(SITE.description)}</description>
    <language>${SITE.language}</language>
    <atom:link href="${x(origin)}/feed.xml" rel="self" type="application/rss+xml"/>
    ${articles[0] ? `<lastBuildDate>${new Date(articles[0].generatedAt).toUTCString()}</lastBuildDate>` : ''}
    <image><url>${x(origin)}/logo.png</url><title>${x(SITE.name)}</title><link>${x(origin)}/</link></image>
${items.join('\n')}
  </channel>
</rss>
`;
}
