'use strict';

const { createEngine } = require('../../core/engine/factory');

/**
 * Register the `status` command.
 *
 * Usage:
 *   qa-engine status               # shows 10 most recent runs
 *   qa-engine status --limit 5     # shows 5 most recent runs
 */
module.exports = function statusCommand(program) {
  program
    .command('status')
    .description('Show recent test runs')
    .option('--limit <n>', 'Number of runs to show', '10')
    .action(async (options) => {
      let engine;
      try {
        engine = await createEngine({ quiet: true });

        const limit = parseInt(options.limit, 10) || 10;
        const runs = await engine.status({ limit });

        if (runs.length === 0) {
          console.log('No test runs found.');
          await engine.shutdown();
          return;
        }

        console.log(`Recent test runs (last ${runs.length}):\n`);

        for (const run of runs) {
          const date = run.started_at
            ? new Date(run.started_at).toLocaleString()
            : 'unknown';
          const status = run.status || 'unknown';
          const app = run.app_id || 'unknown';

          console.log(`  [${date}] ${app} — ${status}`);

          if (run.summary) {
            const s = typeof run.summary === 'string' ? JSON.parse(run.summary) : run.summary;
            console.log(`    Passed: ${s.passed || 0}, Failed: ${s.failed || 0}, Total: ${s.total || 0}`);
          }
        }

        await engine.shutdown();

      } catch (err) {
        console.error(`Error: ${err.message}`);
        if (engine) await engine.shutdown();
        process.exit(2);
      }
    });
};
