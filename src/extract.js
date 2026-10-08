import * as cheerio from 'cheerio';
import { getText, tidy } from './util.js';

const JUNK_TAGS = 'script, style, noscript, iframe, form, nav, header, footer, aside, svg, button';
// Class/id substring matches are fuzzy (WordPress puts "ast-no-sidebar" on <body>), so they only ever
// remove ordinary blocks, never page-level containers or anything holding the article.
const JUNK_BLOCKS =
  '.comments, #comments, .comment, .related, .related-posts, .share, .sharedaddy, .social, .newsletter, ' +
  '.advert, .ads, .ad, [class*="subscribe"], [class*="sidebar"], [id*="sidebar"], [class*="cookie"], [class*="popup"]';
const KEEP = 'html, body, main, article, [itemprop="articleBody"], .entry-content, .post-content, .article-body';

const CONTAINERS = [
  '[itemprop="articleBody"]',
  '.entry-content',
  '.post-body',
  '.post-content',
  '.article-body',
  '.article-content',
  '.body.markup', // substack
  'article',
  'main',
  '#content',
  'body',
];

/**
 * Fetch a web page and pull out its main readable text plus og:image.
 * Deliberately simple: good enough for blogs and news sites, gives up gracefully elsewhere.
 */
export async function extractArticle(url) {
  const html = await getText(url, { accept: 'text/html,application/xhtml+xml', timeoutMs: 15000 });
  const $ = cheerio.load(html);
  const image = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || null;
  $(JUNK_TAGS).remove();
  $(JUNK_BLOCKS)
    .not(KEEP)
    .filter((_, el) => $(el).find(KEEP).length === 0)
    .remove();

  let best = '';
  for (const sel of CONTAINERS) {
    const $c = $(sel).first();
    if (!$c.length) continue;
    const paras = $c
      .find('p, h2, h3, li, blockquote')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 30);
    const text = tidy(paras.join('\n\n'));
    if (text.length > best.length) best = text;
    if (best.length > 1500) break;
  }
  const loose = brSeparatedText($);
  if (loose.length > best.length) best = loose;
  return { text: best.slice(0, 15000), image: image && /^https?:\/\//.test(image) ? image : null };
}

const INLINE = new Set(['a', 'b', 'i', 'em', 'strong', 'span', 'br', 'u', 'small', 'sup', 'sub', 'q', 'cite', 'abbr', 'mark']);

/**
 * Older sites put the article straight into a <div> as text separated by <br><br> instead of <p> tags.
 * Find the element with the most text of its own (text nodes and inline tags) and return that.
 */
function brSeparatedText($) {
  let bestText = '';
  $('div, td, section, article').each((_, el) => {
    const inline = $(el)
      .contents()
      .filter((_, n) => n.type === 'text' || (n.type === 'tag' && INLINE.has(n.name)));
    const own = inline.text().trim();
    if (own.length <= bestText.length || own.length < 400) return;
    const html = inline.map((_, n) => $.html(n)).get().join('');
    bestText = tidy(cheerio.load(`<div>${html.replace(/<br\s*\/?>/gi, '\n')}</div>`)('div').text());
  });
  return bestText;
}
