// Public-site constants and URL helpers shared by the page renderer, feeds and sitemaps.
import { config } from './config.js';

export const SITE = {
  name: config.paperName,
  tagline: 'All the News That’s Unfit to Believe',
  homeTitle: `${config.paperName} — Daily Paranormal, UFO & High Strangeness News`,
  description:
    'A daily newspaper of the internet’s strangest corners: UFO and UAP sightings, ghosts, cryptids, channeled messages, ancient mysteries and the paranormal boards, reported with a straight face every morning.',
  language: 'en',
  locale: 'en_US',
};

// Keyword-friendly URL slugs and blurbs for each section (ids match sources.json).
export const SECTIONS = {
  skies: {
    slug: 'ufo-uap',
    name: 'Skies & Saucers',
    topic: 'UFO & UAP News',
    description: 'UFO and UAP sightings, disclosure news, saucer reports and declassified files from across the internet, updated daily.',
  },
  spirits: {
    slug: 'ghosts-hauntings',
    name: 'Spirits & Specters',
    topic: 'Ghost & Haunting Reports',
    description: 'Ghost sightings, hauntings, poltergeists and other reports from beyond, gathered from paranormal blogs and forums every day.',
  },
  creatures: {
    slug: 'cryptids',
    name: 'Cryptids & Creatures',
    topic: 'Cryptid & Bigfoot Sightings',
    description: 'Bigfoot, phantom big cats, lake monsters and stranger beasts: the latest cryptid sightings and creature reports.',
  },
  occult: {
    slug: 'occult-esoteric',
    name: 'The Occult Desk',
    topic: 'Occult, Esoteric & Channeled Messages',
    description: 'Channeled messages from star beings, synchromysticism, magic and esoteric writing from the far edges of the web.',
  },
  ancient: {
    slug: 'ancient-mysteries',
    name: 'Ancient Enigmas',
    topic: 'Ancient Mysteries & Lost History',
    description: 'Ancient mysteries, strange archaeology, lost civilizations and unexplained artifacts, reported daily.',
  },
  fringe: {
    slug: 'fringe-science',
    name: 'Fringe Science & Earth Changes',
    topic: 'Fringe Science & Anomalies',
    description: 'Anomalies, fringe science, odd physics and earth changes: the edges of science, reported as news.',
  },
  dispatches: {
    slug: 'forum-dispatches',
    name: 'Dispatches from the Boards',
    topic: 'Strange Stories from Reddit & 4chan /x/',
    description: 'High-strangeness stories from Reddit and 4chan’s /x/ board: glitches in the matrix, encounters, time travelers and more.',
  },
  oddities: {
    slug: 'weird-news',
    name: 'Oddities & Curiosities',
    topic: 'Weird News & Oddities',
    description: 'The world’s weird news, curiosities and odd places, collected and retold every day.',
  },
};

export const sectionBySlug = (slug) => Object.entries(SECTIONS).find(([, s]) => s.slug === slug)?.[0] ?? null;

// ---------------------------------------------------------------- URLs

export const editionPath = (date) => `/${date.replaceAll('-', '/')}/`; // 2026-10-12 -> /2026/10/12/
export const articlePath = (date, slug) => `${editionPath(date)}${slug}`;
export const sectionPath = (id) => `/section/${SECTIONS[id]?.slug ?? id}`;

/** Absolute site origin: SITE_URL if configured, else derived from the request (behind a trusted proxy). */
export function siteOrigin(req) {
  if (config.siteUrl) return config.siteUrl;
  return `${req.protocol}://${req.get('host')}`;
}

// ---------------------------------------------------------------- Slugs

export function slugify(text, max = 80) {
  const slug = String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’‘`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= max) return slug || 'story';
  const cut = slug.slice(0, max);
  return cut.slice(0, cut.lastIndexOf('-') > max * 0.6 ? cut.lastIndexOf('-') : max).replace(/-+$/, '');
}

/** Give every article a stable, unique slug and path (derived from its headline). Returns a new object. */
export function prepareEdition(edition) {
  const used = new Set();
  const articles = edition.articles.map((a) => {
    let slug = slugify(a.headline);
    for (let n = 2; used.has(slug); n++) slug = `${slugify(a.headline, 74)}-${n}`;
    used.add(slug);
    return { ...a, slug, path: articlePath(edition.date, slug) };
  });
  return { ...edition, articles, path: editionPath(edition.date) };
}
