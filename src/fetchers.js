import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { getText, getJson, htmlToText, firstImage, truncate, sleep, log } from './util.js';

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ['item', 'entry', 'link', 'category', 'media:content', 'media:thumbnail', 'enclosure'].includes(name),
});

/** Pull a string out of whatever shape fast-xml-parser produced. */
function val(x) {
  if (x == null) return '';
  if (Array.isArray(x)) return val(x[0]);
  if (typeof x === 'object') return val(x['#text'] ?? '');
  return String(x);
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString();
}

function baseItem(source, fields) {
  return {
    sourceId: source.id,
    sourceName: source.name,
    sourceHomepage: source.homepage,
    sectionHint: source.section,
    author: '',
    image: null,
    published: null,
    text: '',
    extra: {},
    ...fields,
  };
}

// ---------------------------------------------------------------- RSS / Atom

function atomLink(links) {
  if (!links) return '';
  const arr = Array.isArray(links) ? links : [links];
  const alt = arr.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate') || arr[0];
  return alt?.['@_href'] || val(alt);
}

function mediaImage(node) {
  for (const key of ['media:content', 'media:thumbnail', 'enclosure']) {
    for (const m of node[key] || []) {
      const url = m['@_url'];
      const type = m['@_type'] || m['@_medium'] || '';
      if (url && (/image/.test(type) || /\.(jpe?g|png|webp)(\?|$)/i.test(url))) return url;
    }
  }
  return null;
}

/** Blogger serves tiny "s72-c" thumbnails; ask for a larger rendition. */
function upsizeBlogger(url) {
  return url ? url.replace(/\/s\d+(-[a-z]+)*\//, '/s1200/').replace(/=s\d+(-[a-z]+)*$/, '=s1200') : url;
}

export async function fetchRss(source) {
  const body = await getText(source.url, { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' });
  const doc = xml.parse(body);
  const items = [];

  if (doc.rss?.channel || doc['rdf:RDF']) {
    const channel = doc.rss?.channel || doc['rdf:RDF'];
    const list = channel.item || doc['rdf:RDF']?.item || [];
    for (const it of list) {
      const html = val(it['content:encoded']) || val(it.description);
      items.push(
        baseItem(source, {
          title: htmlToText(val(it.title)),
          link: val(it.link) || val(it.guid),
          published: parseDate(val(it.pubDate) || val(it['dc:date'])),
          author: htmlToText(val(it['dc:creator']) || val(it.author)),
          text: htmlToText(html),
          image: mediaImage(it) || firstImage(html),
        }),
      );
    }
  } else if (doc.feed) {
    for (const e of doc.feed.entry || []) {
      const html = val(e.content) || val(e.summary);
      const thumb = mediaImage(e);
      items.push(
        baseItem(source, {
          title: htmlToText(val(e.title)),
          link: atomLink(e.link),
          published: parseDate(val(e.published) || val(e.updated)),
          author: htmlToText(val(e.author?.name)),
          text: htmlToText(html),
          image: firstImage(html) || upsizeBlogger(thumb),
        }),
      );
    }
  } else {
    throw new Error('Not an RSS or Atom document');
  }
  return items.filter((i) => i.title && /^https?:\/\//.test(i.link));
}

// ---------------------------------------------------------------- The Anomalist (HTML digest)

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function anomalistDate(label) {
  const m = /([a-z]+)\s+(\d{1,2})/i.exec(label || '');
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  const now = new Date();
  let year = now.getFullYear();
  if (month > now.getMonth() + 1) year -= 1; // a "December" entry seen in January
  // Noon local time, so a date-only entry survives the lookback window for the whole day.
  return new Date(year, month, Number(m[2]), 12).toISOString();
}

export async function fetchAnomalist(source) {
  const $ = cheerio.load(await getText(source.url, { accept: 'text/html' }));
  const items = [];
  let currentDate = null;
  $('div.data > div').each((_, block) => {
    const $b = $(block);
    const dateLabel = $b.find('.date').first().text();
    if (dateLabel) currentDate = anomalistDate(dateLabel);
    const $a = $b.find('.source a').first();
    const link = $a.attr('href');
    if (!link) return;
    const origin = $b.find('.source').text().replace($a.text(), '').trim();
    const $desc = $b.find('.description');
    const related = $desc
      .find('a[href]')
      .map((_, a) => `- ${$(a).text().trim()} (${$(a).attr('href')})`)
      .get();
    items.push(
      baseItem(source, {
        title: $a.text().trim(),
        link,
        published: currentDate,
        text: htmlToText($desc.html() || '') + (related.length ? `\n\nAlso linked in this digest entry:\n${related.join('\n')}` : ''),
        extra: { origin, via: source.name },
      }),
    );
  });
  return items;
}

// ---------------------------------------------------------------- Reddit (one multireddit request)

export async function fetchReddit(source) {
  const subs = source.subreddits.join('+');
  const url = `https://www.reddit.com/r/${subs}/top/.rss?t=day&limit=60`;
  let body;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      body = await getText(url, { accept: 'application/atom+xml, application/xml' });
      break;
    } catch (err) {
      if (err.status !== 429 || attempt === 2) throw err;
      log(`  reddit rate-limited, waiting ${20 * (attempt + 1)}s`);
      await sleep(20000 * (attempt + 1));
    }
  }
  const doc = xml.parse(body);
  const perSub = {};
  const items = [];
  for (const e of doc.feed?.entry || []) {
    const sub = e.category?.[0]?.['@_term'] || 'reddit';
    perSub[sub] = (perSub[sub] || 0) + 1;
    if (perSub[sub] > 2) continue; // keep the big subs from crowding out the small ones
    const $ = cheerio.load(val(e.content));
    const selftext = $('div.md').html();
    items.push(
      baseItem(source, {
        sourceName: `r/${sub}`,
        sourceHomepage: `https://www.reddit.com/r/${sub}/`,
        title: htmlToText(val(e.title)),
        link: atomLink(e.link),
        published: parseDate(val(e.published) || val(e.updated)),
        text: selftext ? htmlToText(selftext) : '(Link or image post with no text body.)',
        extra: { subreddit: sub, platform: 'reddit' },
      }),
    );
  }
  return items;
}

// ---------------------------------------------------------------- 4chan board catalog

export async function fetchFourchan(source) {
  const board = source.board || 'x';
  const pages = await getJson(`https://a.4cdn.org/${board}/catalog.json`);
  const threads = pages.flatMap((p) => p.threads || []);
  return threads
    .filter((t) => !t.sticky && !t.closed && (t.replies || 0) >= (source.minReplies ?? 10))
    // Recurring "/xyz/ General" chat threads aren't news.
    .filter((t) => !/\bgeneral\b|^\s*\/\w+\//i.test(htmlToText(t.sub || '')))
    .sort((a, b) => (b.replies || 0) - (a.replies || 0))
    .map((t) => {
      const op = htmlToText(t.com || '');
      return baseItem(source, {
        title: htmlToText(t.sub || '') || truncate(op.replace(/\n+/g, ' '), 90) || `Thread No. ${t.no}`,
        link: `https://boards.4chan.org/${board}/thread/${t.no}`,
        published: new Date(t.time * 1000).toISOString(),
        text: op,
        extra: { platform: '4chan', board, threadNo: t.no, replies: t.replies, images: t.images },
      });
    });
}

/** Pull the opening post plus a sample of replies for a 4chan thread. */
export async function fetchFourchanThread(board, no, maxReplies = 30) {
  const data = await getJson(`https://a.4cdn.org/${board}/thread/${no}.json`);
  const [op, ...replies] = data.posts || [];
  const lines = replies
    .map((p) => htmlToText(p.com || '').replace(/>>\d+/g, '').trim())
    .filter((t) => t.length > 25)
    .slice(0, maxReplies)
    .map((t) => `- ${truncate(t.replace(/\n+/g, ' '), 400)}`);
  return `OPENING POST:\n${htmlToText(op?.com || '')}\n\nA SAMPLE OF ANONYMOUS REPLIES (${replies.length} total):\n${lines.join('\n')}`;
}

export const fetchers = { rss: fetchRss, anomalist: fetchAnomalist, reddit: fetchReddit, fourchan: fetchFourchan };
