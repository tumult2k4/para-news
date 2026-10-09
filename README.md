# The Para News

*"All the News That's Unfit to Believe"*

The Para News is an automatic daily newspaper about the strangest corners of the internet. Once a day it scrapes 37 fringe sources: UFO blogs, ghost and cryptid sites, channeled messages from star beings, synchromystic decoders, ancient-mystery sites, tabloid weird news, and the paranormal boards of Reddit and 4chan. Claude then picks the best material and rewrites it as broadsheet articles. Every article and brief links back to the original post.

## Quick start

```bash
npm install
copy .env.example .env      # then fill in ANTHROPIC_API_KEY and ADMIN_PASSWORD
npm start                   # http://localhost:3000
```

On the first start the server notices there's no paper for today and prints one immediately, which takes about a minute. After that it prints a new edition every day at 06:00.

On Windows, check that the file is really named `.env`: Notepad likes to save it as `.env.txt`, which the app ignores.

If you have no API key yet, the paper still prints, but as raw "wire copy" (source excerpts instead of written articles). When you add a key and restart, today's wire-copy edition is reprinted with Claude automatically.

## How an edition is made

1. **Collect.** Each source in [sources.json](sources.json) is fetched. There are four source types:
   - `rss` for RSS/Atom feeds
   - `anomalist` for The Anomalist's hand-curated HTML digest
   - `reddit` for twelve subreddits fetched in a single multireddit request, which stays under Reddit's rate limit
   - `fourchan` for the most-replied threads in the /x/ catalog, taken from 4chan's public JSON API
2. **Shortlist.** Only posts from the last 36 hours that haven't already been printed are kept, with a per-source cap. Duplicates are removed by link and by title.
3. **Edit.** One Claude call reads the whole wire, which is typically 60 to 100 items. It picks about 18 articles, a lead story, 12 one-line briefs, a weather forecast and an omen of the day.
4. **Report.** For each pick, the app fetches the full text of the original page (or the whole 4chan thread), and one Claude call writes the article. The writer can drop a story (hate, gore, someone's real mental-health crisis, nothing to report); when it does, an alternate runs instead.
5. **Print.** The edition is saved to `data/editions/YYYY-MM-DD.json` and served at `/`. Past editions stay available from the **Edition** dropdown.

### House style

The writers use a straight-faced 1930s-broadsheet voice. Every claim is attributed ("the poster insists", "the channeled message states") and nothing paranormal is ever stated as fact. Quotes must appear verbatim in the source. Reddit and 4chan usernames are never printed. Each article has a **Strangeness** rating from 1 to 5.

## The admin page

The Press Room lives at **`/admin`**. Nothing on the public paper links to it, and search engines are told not to index it. Sign in with `ADMIN_PASSWORD` from `.env`; the admin page is disabled if that variable is empty. From there you can:

- **Print a New Edition Now.** Scrapes every source and has Claude write a fresh edition. If today's edition already exists, it is replaced.
- **Daily Auto-Print.** Switch the automatic daily edition on or off and choose its time. The change applies immediately and is saved in `data/settings.json`.
- Watch the **press log** live while an edition prints, and browse back issues with their cost.

Sessions last 12 hours and end when the server restarts. After 5 wrong passwords, sign-in is locked for 15 minutes.

## Deploying on Hostinger

The app runs as a Hostinger **Node.js Web App** deployed from GitHub. In the app's settings:

- **Node.js version:** 22.x or 24.x (20.19 or newer is the minimum)
- **Entry file:** `server.js` (in the project root; start command `npm start` works too)
- **Build command / output directory:** leave empty
- **Environment variables:** `ANTHROPIC_API_KEY`, `ADMIN_PASSWORD` and the `DB_…` values (see below). The `.env` file is not in Git.

Hostinger serves the files in `public/` itself and passes everything else to the Node app. If the paper's page loads but stays empty, or `/` answers **503**, the Node process isn't running: open `stderr.log` in the app's folder in File Manager to see why.

## Database (e.g. Hostinger)

Without a database, editions, settings and the printed-links ledger are JSON files in `data/`. That folder isn't in Git, so a host that rebuilds the app from GitHub on every push (Hostinger's Git deployment, for example) loses the whole archive. After each deploy the server would then print a new edition, because it finds none for today.

To avoid this, give the app a MySQL or MariaDB database:

1. In Hostinger's hPanel, go to **Databases → Management** and create a database. Note the database name, user and password; on Hostinger they all start with `u123456789_`.
2. Set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` and `DB_PASSWORD` in the app's environment variables on Hostinger, and in your local `.env`. On the server itself, `DB_HOST` is usually `localhost`.
3. Run `npm run db:setup` once. It creates the tables (all prefixed `pn_`) and imports the editions in `data/`. Running it from your own PC needs **Databases → Remote MySQL** access for your IP, and the remote host name that hPanel shows.

From then on the archive lives in the database: back issues load instantly after a redeploy, and a restart only prints if there is genuinely no edition for today yet. The admin page shows which archive is in use under **Archive**.

## Scheduling

You can schedule the daily print in either of two ways:

- **Leave the server running.** The built-in scheduler prints at the time set in `/admin` (default 06:00, server time zone). If the server was off at print time, it catches up as soon as it starts. When auto-print is switched off, neither happens.
- **Use a Windows scheduled task.** This prints even when the web server isn't running:
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1 -Time 06:00
  ```
  The task runs as soon as possible after a missed start (for example, if the PC was asleep), and it respects the auto-print switch in `/admin`. Its output goes to `data/scrape.log`.

The two methods can run side by side. A lock file stops them from printing at the same time, and a scheduled run skips the day if that day's paper already exists.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Web server + daily scheduler |
| `npm run scrape` | Print today's edition now (skips if it exists) |
| `npm run scrape:force` | Reprint today's edition |
| `npm run scrape:dry` | Fetch every source and list today's candidates; nothing is saved and no AI is used |
| `npm run check-sources` | Health check for every source: reachable? last post date? stale? |
| `npm run db:setup` | Create the database tables and import `data/` (add `-- --overwrite` to replace editions already there) |

## Configuration (`.env`)

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required for written articles |
| `ADMIN_PASSWORD` | — | Password for `/admin`; admin is disabled when empty |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` | — | MySQL/MariaDB archive (see above); files in `data/` when unset |
| `CLAUDE_MODEL` | `claude-sonnet-5-5` | Used by both the editor and the writers. `claude-opus-5-5` writes a little better at about twice the cost; `claude-haiku-5-5` costs pennies |
| `EDITOR_EFFORT` / `WRITER_EFFORT` | `medium` / `low` | Thinking effort for the editor and writers |
| `AUTO_GENERATE` / `PRINT_TIME` | `true` / `06:00` | Starting values for daily auto-print; once changed in `/admin`, the admin values win |
| `MAX_ARTICLES` / `MAX_BRIEFS` | `18` / `12` | Paper size |
| `LOOKBACK_HOURS` | `36` | How fresh a post must be |
| `PAPER_NAME` | `The Para News` | Masthead |
| `AI_MODE` | `on` | `off` forces raw wire copy |

**Cost:** an edition with Sonnet 5.5 makes about 20 calls, takes about a minute and costs roughly $0.25 (about $8 a month). The page footer and `/admin` show the estimated cost of each edition.

**Refusals:** Sonnet 5.5 and Opus 5.5 requests opt into Anthropic's server-side refusal fallback (`fallbacks: "default"`). If a safety classifier declines a story, another model finishes it. If the whole chain declines, that story falls back to wire copy.

## The sources

Every source was verified live on 2026-10-08. Run `npm run check-sources` now and then to find feeds that have died or gone quiet.

| Section | Sources |
|---|---|
| Skies & Saucers | UFO Sightings Daily (Scott Waring's alien faces on Mars), Inexplicata (Latin American UFO reports), The Black Vault (FOIA files), MUFON, Liberation Times, Unknown Country (Whitley Strieber) |
| Spirits & Specters | Higgypop, Spooky Isles, Weird Darkness, Paranormal Daily News |
| Cryptids & Creatures | Cryptomundo (cryptid stories also arrive via The Anomalist, Unexplained Mysteries and Reddit) |
| The Occult Desk | Era of Light (daily channeled Pleiadian/Arcturian messages), Unarius Academy of Science, The Secret Sun, MFTIC Research and The SynchroMystic (synchromysticism), In5D, New Dawn, The Digital Ambler, Gnostic Warrior, Occult World |
| Ancient Enigmas | Ancient Pages, MessageToEagle, Ancient Origins |
| Fringe Science | The Anomalist (daily digest, links out to the originals), The Daily Grail, Unexplained Mysteries, The Debrief |
| Dispatches from the Boards | 4chan /x/; Reddit: r/HighStrangeness, Glitch_in_the_Matrix, Thetruthishere, Retconned, Humanoidencounters, Experiencers, skinwalkers, RemoteViewing, starseeds, occult, Paranormal, UFOs |
| Oddities & Curiosities | Atlas Obscura, Futility Closet, UPI Odd News, Daily Star and Mirror weird news, Oddity Central, Cult of Weird |

Two working feeds are included but **disabled**: Sott.net (mostly geopolitics) and Operation Disclosure (QAnon-style politics rather than the paranormal). Set `"enabled": true` in `sources.json` to turn them on. Three blogs that have gone quiet are also listed but disabled: Hidden Experience (last post 2024), Nick Redfern (2023) and Earthfiles (April 2026).

On purpose, the source list contains no personal blogs from people who describe themselves as targets of gang-stalking or "targeted individual" campaigns. Those blogs are usually written by people in real distress, not by publishers of strange content.

### Adding a source

Add an entry to `sources.json`:

```json
{ "id": "mysite", "name": "My Strange Site", "type": "rss", "url": "https://example.com/feed/",
  "homepage": "https://example.com/", "section": "spirits", "maxItems": 3, "enabled": true }
```

Most WordPress sites have a feed at `/feed/`, Substacks at `/feed`, and Blogger blogs at `/feeds/posts/default`.

## Layout

```
sources.json          the source list
src/fetchers.js       RSS/Atom, Anomalist, Reddit and 4chan scrapers
src/extract.js        full-text extraction from article pages
src/ai.js             Claude editor + writer (structured JSON output)
src/pipeline.js       collect -> shortlist -> edit -> report -> print
src/store.js          storage: MySQL (store-mysql.js) or files in data/ (store-files.js)
src/server.js         Express server, public API and daily scheduler
src/admin.js          /admin sign-in, sessions and admin API
src/settings.js       auto-print settings (data/settings.json)
public/               the newspaper front end
admin/                the Press Room (admin) page
data/                 local archive when no database is set (git-ignored)
```
