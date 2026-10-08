import express from 'express';
import cron from 'node-cron';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { runEdition } from './pipeline.js';
import { listEditionDates, loadEdition } from './store.js';
import { getSettings, timeToCron } from './settings.js';
import { createAdminRouter } from './admin.js';
import { localDate, log } from './util.js';

// ---------------------------------------------------------------- Daily scheduler

let task = null;
const scheduler = {
  nextRun: () => task?.getNextRun() ?? null,
  /** (Re)create the daily job from the current settings. */
  apply() {
    task?.destroy();
    task = null;
    const { autoGenerate, printTime } = getSettings();
    if (!autoGenerate) return log('Auto-print is OFF; editions are only printed from /admin.');
    task = cron.schedule(
      timeToCron(printTime),
      () => {
        log('Scheduled run starting.');
        runEdition().catch(() => {}); // skips if today's paper already exists (e.g. printed by the scheduled task)
      },
      { timezone: config.timezone, noOverlap: true, name: 'daily-edition' },
    );
    log(`Auto-print is ON: daily at ${printTime} (${config.timezone}); next at ${task.getNextRun()?.toLocaleString()}`);
  },
};

// ---------------------------------------------------------------- HTTP

const app = express();
app.disable('x-powered-by');
app.use('/admin', createAdminRouter(scheduler));
app.use(express.static(path.join(ROOT, 'public')));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

app.get('/api/editions', (req, res) => {
  res.json(
    listEditionDates().map((date) => {
      const e = loadEdition(date);
      return { date, issue: e?.issue, articles: e?.articles?.length ?? 0, lead: e?.articles?.find((a) => a.lead)?.headline ?? null };
    }),
  );
});

app.get('/api/editions/:date', (req, res) => {
  const date = req.params.date === 'latest' ? listEditionDates()[0] : req.params.date;
  if (!date || !DATE_RE.test(date)) return res.status(404).json({ error: 'No editions yet.' });
  const edition = loadEdition(date);
  if (!edition) return res.status(404).json({ error: `No edition for ${date}.` });
  res.json(edition);
});

app.listen(config.port, () => {
  log(`${config.paperName} is on the newsstand at http://localhost:${config.port}`);
  if (!config.adminPassword) log('Admin page disabled: set ADMIN_PASSWORD in .env to enable /admin.');
  scheduler.apply();

  // Catch up if the machine was off at print time: make sure today's paper exists.
  if (getSettings().autoGenerate && process.env.CATCH_UP_ON_START !== 'false') {
    const today = loadEdition(localDate());
    const hasKey = config.aiEnabled && Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
    if (!today) {
      log('No edition for today yet; printing one now.');
      runEdition().catch(() => {});
    } else if (!today.ai?.used && hasKey) {
      log("Today's edition is raw wire copy and an API key is now set; reprinting with Claude.");
      runEdition({ force: true }).catch(() => {});
    }
  }
});
