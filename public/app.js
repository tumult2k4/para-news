// Front page renderer. Every scraped string is inserted with textContent, never innerHTML.

const $ = (sel) => document.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
const ext = (url, text, cls) => (safeUrl(url) ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: cls }, text) : text);

const longDate = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null);

function roman(n) {
  const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out || 'I';
}

// ------------------------------------------------------------ Theme

const THEME_KEY = 'paranews-theme';
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
try { applyTheme(localStorage.getItem(THEME_KEY)); } catch {}
$('#theme-toggle').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch {}
});

// ------------------------------------------------------------ Article rendering

function meter(level) {
  if (!level) return null;
  return h('div', { class: 'meter', title: `Strangeness ${level} of 5` }, 'Strangeness', h('span', { class: 'eyes', 'aria-hidden': 'true' }, '◉'.repeat(level) + '○'.repeat(5 - level)));
}

// "Source: Daily Grail · Oct 8" or, for digest finds, "Source: Liberation Times · found via The Anomalist · Oct 8"
function provenance(o) {
  const when = shortDate(o.published);
  return h(
    'div',
    { class: 'provenance' },
    'Source: ',
    o.origin || ext(o.sourceHomepage, o.source),
    o.via ? [' · found via ', ext(o.sourceHomepage, o.via)] : null,
    when ? ` · ${when}` : null,
    h('br'),
    ext(o.url, 'Read the original post →', 'original'),
  );
}

function article(a, { lead = false } = {}) {
  const paragraphs = a.paragraphs || [];
  const visible = lead ? paragraphs.length : Math.min(2, paragraphs.length);
  const body = h('div', { class: 'body' });
  paragraphs.forEach((p, i) => {
    const para = h('p', { class: i >= visible ? 'more' : null, hidden: i >= visible });
    if (i === 0 && a.dateline) para.append(h('span', { class: 'dateline' }, `${a.dateline.toUpperCase()} — `));
    para.append(p);
    body.append(para);
  });
  if (visible < paragraphs.length) {
    const btn = h('button', { type: 'button', class: 'continue' }, `Continued (${paragraphs.length - visible} more) ▸`);
    btn.addEventListener('click', () => {
      body.querySelectorAll('.more').forEach((p) => (p.hidden = false));
      btn.remove();
    });
    body.append(btn);
  }

  const img = safeUrl(a.image)
    ? h(
        'figure',
        {},
        h('img', {
          src: a.image,
          alt: '',
          loading: lead ? 'eager' : 'lazy',
          referrerpolicy: 'no-referrer',
          onerror: (e) => e.target.closest('figure').remove(),
        }),
        h('figcaption', {}, `Image: ${a.original.origin || a.original.source}`),
      )
    : null;

  return h(
    'article',
    { class: `article${lead ? ' lead' : ''}${a.aiWritten ? '' : ' wire'}`, id: `a-${a.id}` },
    a.kicker ? h('p', { class: 'kicker' }, a.kicker) : null,
    h(lead ? 'h2' : 'h3', { class: 'headline' }, ext(a.original.url, a.headline, 'headline-link')),
    a.deck ? h('p', { class: 'deck' }, a.deck) : null,
    meter(a.weirdness),
    img,
    body,
    provenance(a.original),
  );
}

function briefsColumn(briefs) {
  return h(
    'aside',
    { class: 'briefs' },
    h('h3', {}, 'In Brief'),
    h(
      'ol',
      {},
      briefs.map((b) =>
        h('li', {}, b.blurb, h('span', { class: 'brief-source' }, ext(b.url, b.source), ' · ', ext(b.url, 'original →'))),
      ),
    ),
  );
}

// ------------------------------------------------------------ Page

let current = null;
let activeSection = location.hash.slice(1) || 'all';

function renderNav(edition) {
  const nav = $('#section-nav');
  nav.replaceChildren();
  const present = new Set(edition.articles.map((a) => a.section));
  const entries = [['all', 'Front Page'], ...Object.entries(edition.sections).filter(([id]) => present.has(id))];
  for (const [id, name] of entries) {
    nav.append(h('a', { href: `#${id}`, 'aria-current': String(id === activeSection) }, name));
  }
}

function renderEdition(edition) {
  current = edition;
  if (!edition.articles.some((a) => a.section === activeSection)) activeSection = 'all';
  document.title = `${edition.paperName} — ${longDate(edition.date)}`;
  $('#paper-name').textContent = edition.paperName;
  $('#folio-issue').textContent = `Vol. ${roman(edition.volume || 1)} · No. ${edition.issue}`;
  $('#folio-date').textContent = longDate(edition.date);
  $('#weather').textContent = edition.weather || '—';
  $('#omen').textContent = edition.omen || '—';
  renderNav(edition);

  const notice = $('#notice');
  notice.hidden = !edition.notes?.length;
  notice.textContent = (edition.notes || []).join(' ');

  const front = $('#front');
  front.replaceChildren();

  const leadArticle = edition.articles.find((a) => a.lead) || edition.articles[0];
  const inSection = (a) => activeSection === 'all' || a.section === activeSection;

  if (activeSection === 'all') {
    front.append(h('div', { class: 'front-top' }, h('div', { class: 'lead' }, article(leadArticle, { lead: true })), briefsColumn(edition.briefs || [])));
  }

  for (const [id, name] of Object.entries(edition.sections)) {
    if (activeSection !== 'all' && id !== activeSection) continue;
    const items = edition.articles.filter((a) => a.section === id && inSection(a) && (activeSection !== 'all' || a !== leadArticle));
    if (!items.length) continue;
    front.append(
      h(
        'section',
        { class: 'section-block', id: `section-${id}` },
        h('div', { class: 'section-banner' }, h('h2', {}, name, h('small', {}, `${items.length} ${items.length === 1 ? 'report' : 'reports'}`))),
        h('div', { class: 'columns' }, items.map((a) => article(a))),
      ),
    );
  }
  renderColophon(edition);
}

function renderColophon(e) {
  const ok = e.sourceReport.filter((s) => s.ok).length;
  const printed = new Date(e.generatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const ai = e.ai?.used ? `Written by ${e.ai.model} in ${e.ai.calls} calls (≈ $${e.ai.estCostUsd})` : 'Printed as raw wire copy (no AI)';
  $('#colophon').replaceChildren(
    h('div', {}, `Printed ${printed} · ${ok} of ${e.sourceReport.length} sources answered · ${e.stats.candidates} fresh items on the wire · ${ai}`),
    h(
      'details',
      {},
      h('summary', {}, 'Correspondents consulted for this edition'),
      h(
        'ul',
        { class: 'source-list' },
        e.sourceReport.map((s) => h('li', { class: s.ok ? null : 'bad', title: s.error || '' }, s.ok ? '✓ ' : '✗ ', s.name, s.ok ? '' : ` (${s.error})`)),
      ),
    ),
  );
}

function renderEmpty() {
  $('#front').replaceChildren($('#empty-template').content.cloneNode(true));
  $('#folio-date').textContent = longDate(new Date().toLocaleDateString('en-CA'));
}

async function loadArchive(selected) {
  const list = await fetch('/api/editions').then((r) => r.json());
  const sel = $('#archive');
  sel.replaceChildren(...list.map((e) => h('option', { value: e.date, selected: e.date === selected }, `${shortDate(`${e.date}T12:00:00`)} · No. ${e.issue}`)));
  sel.disabled = !list.length;
  return list;
}

async function show(date) {
  const res = await fetch(`/api/editions/${date || 'latest'}`);
  if (!res.ok) {
    renderEmpty();
    if (!date) setTimeout(() => show(), 8000); // the first edition may be on the press right now
    return;
  }
  const edition = await res.json();
  renderEdition(edition);
  await loadArchive(edition.date);
}

$('#archive').addEventListener('change', (e) => {
  const url = new URL(location);
  url.searchParams.set('date', e.target.value);
  history.pushState({}, '', url);
  show(e.target.value);
});

window.addEventListener('hashchange', () => {
  activeSection = location.hash.slice(1) || 'all';
  if (current) {
    renderEdition(current);
    scrollTo({ top: $('.toolbar').offsetTop, behavior: 'smooth' });
  }
});
window.addEventListener('popstate', () => show(new URLSearchParams(location.search).get('date')));

show(new URLSearchParams(location.search).get('date'));
