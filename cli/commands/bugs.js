'use strict';

const { createEngine } = require('../../core/engine/factory');

/**
 * Register the `bugs` command.
 *
 * Usage:
 *   qa-engine bugs --app brainstormy                # all bugs
 *   qa-engine bugs --app brainstormy --status open  # only open bugs
 */
module.exports = function bugsCommand(program) {
  program
    .command('bugs')
    .description('List bugs for an application')
    .requiredOption('--app <appId>', 'Application ID')
    .option('--status <status>', 'Filter by status (open, fixed, closed)')
    .option('--limit <n>', 'Number of bugs to show', '20')
    .action(async (options) => {
      let engine;
      try {
        engine = await createEngine({ quiet: true });

        const limit = parseInt(options.limit, 10) || 20;
        const bugs = await engine.bugs(options.app, {
          status: options.status || undefined,
          limit
        });

        if (bugs.length === 0) {
          const qualifier = options.status ? ` with status "${options.status}"` : '';
          console.log(`No bugs found for "${options.app}"${qualifier}.`);
          await engine.shutdown();
          return;
        }

        console.log(`Bugs for "${options.app}" (${bugs.length}):\n`);

        for (const bug of bugs) {
          const date = bug.created_at
            ? new Date(bug.created_at).toLocaleString()
            : 'unknown';
          const severity = bug.severity || 'unknown';
          const status = bug.status || 'open';
          const title = bug.title || bug.bug_id || 'untitled';

          console.log(`  [${severity.toUpperCase()}] ${title}`);
          console.log(`    Status: ${status} | Created: ${date}`);

          if (bug.external_issue_url) {
            console.log(`    Linear: ${bug.external_issue_url}`);
          }
          console.log('');
        }

        await engine.shutdown();

      } catch (err) {
        console.error(`Error: ${err.message}`);
        if (engine) await engine.shutdown();
        process.exit(2);
      }
    });
};
