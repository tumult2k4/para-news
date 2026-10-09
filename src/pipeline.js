import { createHash } from 'node:crypto';
import { config, loadSources } from './config.js';
import { fetchers, fetchFourchanThread } from './fetchers.js';
import { extractArticle } from './extract.js';
import { editEdition, writeArticle, usage, AiUnavailableError } from './ai.js';
import { listEditions, editionExists, loadEdition, saveEdition, loadSeen, setSeenForDate, saveStatus, acquireLock, releaseLock } from './store.js';
import { localDate, mapLimit, truncate, sleep, log } from './util.js';

let running = null;
export const isRunning = () => running !== null;

/** Print one edition. Concurrent calls share the run already in progress. */
export function runEdition(opts = {}) {
  if (!running) {
    running = (async () => {
      if (opts.dryRun) return printEdition(opts);
      if (!(await acquireLock())) {
        log('Another process is already printing; skipping this run.');
        throw new Error('Another print run is already in progress.');
      }
      try {
        return await printEdition(opts);
      } finally {
        await releaseLock();
      }
    })().finally(() => {
      running = null;
    });
  }
  return running;
}

// ---------------------------------------------------------------- 1. Collect

async function collect(sources) {
  const report = [];
  const results = await mapLimit(sources, 6, async (source) => {
    const fetcher = fetchers[source.type];
    const started = Date.now();
    try {
      if (!fetcher) throw new Error(`Unknown source type "${source.type}"`);
      const items = await fetcher(source);
      report.push({ id: source.id, name: source.name, ok: true, fetched: items.length, ms: Date.now() - started });
      return items;
    } catch (err) {
      log(`  ✗ ${source.name}: ${err.message}`);
      report.push({ id: source.id, name: source.name, ok: false, error: err.message, ms: Date.now() - started });
      return [];
    }
  });
  return { items: results.flat(), report };
}

const normTitle = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Keep fresh, unprinted, de-duplicated items, at most maxItems per source (in feed order). */
function shortlist(items, sources, seen, date) {
  const cutoff = Date.now() - config.lookbackHours * 3600e3;
  const maxBySource = Object.fromEntries(sources.map((s) => [s.id, s.maxItems ?? 3]));
  const perSource = {};
  const links = new Set();
  const titles = new Set();
  const out = [];
  for (const it of items) {
    if (it.published && new Date(it.published).getTime() < cutoff) continue;
    if (seen[it.link] && seen[it.link] !== date) continue;
    const t = normTitle(it.title);
    if (links.has(it.link) || titles.has(t)) continue;
    if ((perSource[it.sourceId] = (perSource[it.sourceId] || 0) + 1) > maxBySource[it.sourceId]) continue;
    links.add(it.link);
    titles.add(t);
    out.push(it);
  }
  return out;
}

// ---------------------------------------------------------------- 2. Enrich

async function enrich(item) {
  try {
    if (item.extra?.platform === '4chan') {
      item.fullText = await fetchFourchanThread(item.extra.board, item.extra.threadNo);
      await sleep(1100); // 4chan API asks for at most one request per second
    } else if (item.extra?.platform !== 'reddit' && item.text.length < 1500) {
      const page = await extractArticle(item.link);
      if (page.text.length > item.text.length) item.fullText = item.extra?.origin ? `${item.text}\n\nFULL ARTICLE:\n${page.text}` : page.text;
      if (!item.image && page.image) item.image = page.image;
    }
  } catch (err) {
    log(`  (could not enrich ${item.link}: ${err.message})`);
  }
  return item;
}

// ---------------------------------------------------------------- No-AI fallbacks

const WEATHER = [
  'Overcast with scattered orbs; 40% chance of missing time after dusk.',
  'Clear skies over Area 51. Visibility: classified.',
  'Light drizzle of frogs in the afternoon, clearing by evening.',
  'Fog rolling in from the astral plane. Drive carefully.',
];
const OMENS = [
  'A crow will look at you knowingly. Look back.',
  'The number 23 appears thrice before noon.',
  'Do not answer the door for the man in the black hat.',
  'Something you lost in 2004 is about to turn up.',
];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function heuristicEdit(candidates, sections) {
  // Round-robin across sources so one prolific feed can't fill the paper.
  const bySource = new Map();
  candidates.forEach((c, index) => {
    if (!bySource.has(c.sourceId)) bySource.set(c.sourceId, []);
    bySource.get(c.sourceId).push(index);
  });
  const order = [];
  for (let round = 0; order.length < candidates.length; round++) {
    for (const idxs of bySource.values()) if (idxs[round] !== undefined) order.push(idxs[round]);
  }
  const ids = Object.keys(sections);
  const articles = order.slice(0, config.maxArticles).map((index) => ({
    index,
    section: ids.includes(candidates[index].sectionHint) ? candidates[index].sectionHint : ids[0],
  }));
  const briefs = order.slice(config.maxArticles, config.maxArticles + config.maxBriefs).map((index) => ({ index, blurb: candidates[index].title }));
  const lead = articles.find((a) => candidates[a.index].image)?.index ?? articles[0]?.index;
  return { lead, articles, briefs, weather: pick(WEATHER), omen: pick(OMENS) };
}

function wireCopy(item) {
  const paragraphs = truncate(item.fullText || item.text, 1400)
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 5);
  return { skip: false, kicker: 'WIRE COPY', headline: item.title, deck: '', dateline: '', paragraphs, weirdness: null, wire: true };
}

// ---------------------------------------------------------------- 3. Print

async function printEdition({ date = localDate(), force = false, dryRun = false, noAi = false } = {}) {
  if (!force && !dryRun && (await editionExists(date))) {
    log(`Edition ${date} already exists (use --force to reprint).`);
    return await loadEdition(date);
  }
  const started = Date.now();
  if (!dryRun) await saveStatus({ running: true, startedAt: new Date().toISOString() });
  usage.reset();
  let aiOn = config.aiEnabled && !noAi;
  const notes = [];

  try {
    const { sections, sources } = loadSources();
    log(`Printing ${config.paperName} for ${date}: fetching ${sources.length} sources…`);
    const { items, report } = await collect(sources);
    const seen = await loadSeen();
    const candidates = shortlist(items, sources, seen, date);
    log(`Wire: ${items.length} items fetched, ${candidates.length} fresh candidates.`);
    if (!candidates.length) throw new Error('No fresh items found on any source.');

    if (dryRun) {
      for (const c of candidates) console.log(`- [${c.sourceName}] ${c.title}  (${c.published?.slice(0, 10) ?? 'undated'})`);
      return { candidates, report };
    }

    // Editor
    let plan;
    if (aiOn) {
      try {
        log(`Editor (${config.model}) is choosing stories…`);
        plan = await editEdition(candidates, sections, { maxArticles: config.maxArticles, maxBriefs: config.maxBriefs });
      } catch (err) {
        if (err instanceof AiUnavailableError) {
          aiOn = false;
          notes.push(`${err.message}. This edition was printed as raw wire copy, unedited.`);
        } else notes.push(`Editor failed (${err.message}); stories chosen automatically.`);
        log(`  ${notes.at(-1)}`);
      }
    } else {
      notes.push('AI is switched off. Printed as raw wire copy.');
    }
    plan ||= heuristicEdit(candidates, sections);

    // Writers: work through picks (alternates included) until the paper is full.
    const kept = [];
    const queue = [...plan.articles];
    while (kept.length < config.maxArticles && queue.length) {
      const batch = queue.splice(0, config.maxArticles - kept.length);
      log(`Writing ${batch.length} articles…`);
      const written = await mapLimit(batch, aiOn ? config.writerConcurrency : 6, async (pickd) => {
        const item = await enrich(candidates[pickd.index]);
        const isLead = pickd.index === plan.lead;
        let body;
        if (aiOn) {
          try {
            body = await writeArticle(item, { sectionName: sections[pickd.section], isLead });
          } catch (err) {
            if (err instanceof AiUnavailableError) aiOn = false;
            log(`  writer failed for "${item.title}": ${err.message}`);
          }
        }
        body ||= wireCopy(item);
        if (body.skip) {
          log(`  skipped: ${item.title}${body.skip_reason ? ` (${body.skip_reason})` : ''}`);
          return null;
        }
        return { pickd, item, body, isLead };
      });
      kept.push(...written.filter(Boolean));
    }
    if (!kept.length) throw new Error('Every story was dropped; nothing to print.');
    if (!kept.some((k) => k.isLead)) (kept.find((k) => k.item.image) || kept[0]).isLead = true;

    const articles = kept.map(({ pickd, item, body, isLead }) => ({
      id: createHash('sha1').update(item.link).digest('hex').slice(0, 12),
      section: pickd.section,
      lead: isLead,
      kicker: body.kicker,
      headline: body.headline,
      deck: body.deck,
      dateline: body.dateline,
      paragraphs: body.paragraphs,
      weirdness: body.weirdness,
      aiWritten: !body.wire,
      image: item.image,
      original: {
        title: item.title,
        url: item.link,
        published: item.published,
        source: item.sourceName,
        sourceHomepage: item.sourceHomepage,
        origin: item.extra?.origin || null,
        via: item.extra?.via || null,
      },
    }));
    articles.sort((a, b) => Number(b.lead) - Number(a.lead));

    const briefs = plan.briefs.map(({ index, blurb }) => {
      const c = candidates[index];
      return { blurb, title: c.title, url: c.link, source: c.sourceName, sourceHomepage: c.sourceHomepage, section: c.sectionHint };
    });

    const priorIssues = (await listEditions()).map((e) => e.date).filter((d) => d !== date);
    const edition = {
      date,
      paperName: config.paperName,
      issue: priorIssues.length + 1,
      volume: Number(date.slice(0, 4)) - Number((priorIssues.at(-1) || date).slice(0, 4)) + 1,
      generatedAt: new Date().toISOString(),
      ai: { used: articles.some((a) => a.aiWritten), model: config.model, calls: usage.calls, inputTokens: usage.input, outputTokens: usage.output, estCostUsd: usage.costUsd() },
      weather: plan.weather,
      omen: plan.omen,
      sections,
      articles,
      briefs,
      notes,
      sourceReport: report.sort((a, b) => a.name.localeCompare(b.name)),
      stats: { fetched: items.length, candidates: candidates.length, durationSec: Math.round((Date.now() - started) / 1000) },
    };
    await saveEdition(edition);
    await setSeenForDate(date, [...articles.map((a) => a.original.url), ...briefs.map((b) => b.url)]);

    await saveStatus({ running: false, lastRunAt: edition.generatedAt, lastRunOk: true, lastError: null, lastEdition: date });
    log(`Printed ${articles.length} articles and ${briefs.length} briefs in ${edition.stats.durationSec}s` + (edition.ai.used ? ` (${usage.calls} Claude calls, ~$${edition.ai.estCostUsd}).` : '.'));
    return edition;
  } catch (err) {
    if (!dryRun) await saveStatus({ running: false, lastRunAt: new Date().toISOString(), lastRunOk: false, lastError: err.message }).catch(() => {});
    log(`Edition failed: ${err.message}`);
    throw err;
  }
}
