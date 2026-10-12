// In-memory index of every article in every edition. Powers the archive search, section pages,
// sitemaps and the feed without loading whole editions on each request. Rebuilt incrementally:
// only editions that are new or were reprinted since the last build are read again.
import { listEditions, loadEdition } from './store.js';
import { prepareEdition } from './site.js';

let byDate = new Map(); // date -> { generatedAt, entries }
let snapshot = null; // { key, articles }
let building = null;

function entriesFor(raw) {
  const e = prepareEdition(raw);
  return e.articles.map((a, order) => ({
    date: e.date,
    issue: e.issue,
    generatedAt: e.generatedAt,
    order,
    path: a.path,
    headline: a.headline,
    deck: a.deck,
    kicker: a.kicker,
    dateline: a.dateline,
    excerpt: a.paragraphs[0] || '',
    section: a.section,
    weirdness: a.weirdness || 0,
    lead: Boolean(a.lead),
    aiWritten: a.aiWritten,
    image: a.image,
    original: a.original,
    source: a.original.origin || a.original.source,
    haystack: [a.headline, a.deck, a.kicker, a.dateline, ...a.paragraphs, a.original.title, a.original.origin, a.original.source]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  }));
}

/** Every article, newest edition first and in paper order within an edition. */
export async function articleIndex() {
  const editions = await listEditions();
  const key = editions.map((e) => `${e.date}@${e.generatedAt}`).join('|');
  if (snapshot?.key === key) return snapshot.articles;
  building ||= (async () => {
    const next = new Map();
    for (const summary of editions) {
      const known = byDate.get(summary.date);
      if (known && known.generatedAt === summary.generatedAt) {
        next.set(summary.date, known);
        continue;
      }
      const raw = await loadEdition(summary.date);
      if (raw) next.set(summary.date, { generatedAt: raw.generatedAt, entries: entriesFor(raw) });
    }
    byDate = next;
    snapshot = { key, articles: editions.flatMap((e) => next.get(e.date)?.entries ?? []) };
    return snapshot.articles;
  })().finally(() => {
    building = null;
  });
  return building;
}

export const SORTS = { newest: 'Newest first', oldest: 'Oldest first', strangest: 'Strangest first' };

/** Apply archive filters. All filters are optional and already validated by the caller. */
export function filterArticles(all, { q, section, strangeness, source, month, sort } = {}) {
  let list = all;
  if (section) list = list.filter((a) => a.section === section);
  if (strangeness) list = list.filter((a) => a.weirdness >= strangeness);
  if (source) list = list.filter((a) => a.source === source);
  if (month) list = list.filter((a) => a.date.startsWith(month));
  if (q) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    list = list.filter((a) => terms.every((t) => a.haystack.includes(t)));
  }
  const byDateAsc = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order);
  if (sort === 'oldest') list = [...list].sort(byDateAsc);
  if (sort === 'strangest') list = [...list].sort((a, b) => b.weirdness - a.weirdness || -byDateAsc(a, b));
  return list;
}

/** Choices for the filter dropdowns, from the whole archive. */
export function facets(all) {
  const sources = new Map();
  const months = new Set();
  const atLeast = [0, 0, 0, 0, 0, 0]; // atLeast[n] = stories with strangeness >= n
  for (const a of all) {
    for (let n = 1; n <= (a.weirdness || 0); n++) atLeast[n]++;
    if (a.source) sources.set(a.source, (sources.get(a.source) || 0) + 1);
    months.add(a.date.slice(0, 7));
  }
  return {
    sources: [...sources].sort((a, b) => a[0].localeCompare(b[0])),
    months: [...months].sort().reverse(),
    strangeness: atLeast,
  };
}
