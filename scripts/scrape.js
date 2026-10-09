#!/usr/bin/env node
// Print an edition from the command line.
//   node scripts/scrape.js              print today's edition (skips if it already exists)
//   node scripts/scrape.js --force      reprint today's edition
//   node scripts/scrape.js --dry-run    fetch and list candidates only, no AI, nothing saved
//   node scripts/scrape.js --no-ai      print raw wire copy without calling Claude
//   node scripts/scrape.js --scheduled  like the default, but does nothing if auto-print is off in /admin
import { runEdition } from '../src/pipeline.js';
import { getSettings } from '../src/settings.js';
import { log } from '../src/util.js';

const args = new Set(process.argv.slice(2));
if (args.has('--scheduled') && !(await getSettings()).autoGenerate) {
  log('Auto-print is switched off in /admin; not printing.');
  process.exit(0);
}
try {
  await runEdition({ force: args.has('--force'), dryRun: args.has('--dry-run'), noAi: args.has('--no-ai') });
  process.exit(0);
} catch {
  process.exit(1);
}
