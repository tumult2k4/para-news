import * as cheerio from 'cheerio';
import { config } from './config.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
  }
}

/** fetch() with a timeout, browser-ish headers and a typed error on non-2xx. Returns the Response. */
export async function httpGet(url, { timeoutMs = 20000, accept = '*/*', headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': config.userAgent, Accept: accept, 'Accept-Language': 'en-US,en;q=0.8', ...headers },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new HttpError(res.status, url);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function getText(url, opts) {
  const res = await httpGet(url, opts);
  return res.text();
}

export async function getJson(url, opts) {
  const res = await httpGet(url, { accept: 'application/json', ...opts });
  return res.json();
}

/** HTML fragment -> readable plain text with paragraph breaks preserved. */
export function htmlToText(html) {
  if (!html) return '';
  const $ = cheerio.load(`<div id="__root">${html}</div>`);
  $('script, style, noscript, iframe').remove();
  $('br').replaceWith('\n');
  $('p, div, li, h1, h2, h3, h4, blockquote').each((_, el) => {
    $(el).prepend('\n').append('\n');
  });
  return tidy($('#__root').text());
}

export function tidy(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncate(text, max) {
  if (!text || text.length <= max) return text || '';
  const cut = text.slice(0, max);
  const lastBreak = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'));
  return (lastBreak > max * 0.6 ? cut.slice(0, lastBreak + 1) : cut).trim() + ' …';
}

/** First <img src> in an HTML fragment, if any. */
export function firstImage(html) {
  if (!html) return null;
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  if (!m) return null;
  const src = m[1];
  if (!/^https?:\/\//i.test(src)) return null;
  // Skip tracking pixels, emoji and feed badges.
  if (/feedburner|pixel|emoji|gravatar|\.gif(\?|$)|1x1|wp-includes|share|badge/i.test(src)) return null;
  return src;
}

/** Local-time YYYY-MM-DD. */
export function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Run async fn over items with limited concurrency, preserving order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// The last few hundred log lines, so /admin can show a print run's progress.
const recent = [];
export const recentLog = (n = 80) => recent.slice(-n);

export function log(...args) {
  const line = `[${new Date().toLocaleTimeString()}] ${args.join(' ')}`;
  console.log(line);
  recent.push(line);
  if (recent.length > 300) recent.splice(0, recent.length - 300);
}
