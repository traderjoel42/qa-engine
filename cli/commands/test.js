'use strict';

const { createEngine } = require('../../core/engine/factory');

/**
 * Register the `test` command.
 *
 * Usage:
 *   qa-engine test --app brainstormy --agent healer
 *   qa-engine test --app brainstormy                    # runs all enabled agents
 */
module.exports = function testCommand(program) {
  program
    .command('test')
    .description('Run tests for an application')
    .requiredOption('--app <appId>', 'Application ID to test')
    .option('--agent <agentId>', 'Specific agent to run (omit for all enabled agents)')
    .option('--mode <mode>', 'Test mode: smoke, regression, full', 'smoke')
    .option('--skip-bug-detection', 'Disable bug detection and Linear integration')
    .action(async (options) => {
      let engine;
      try {
        engine = await createEngine();

        const runOptions = { mode: options.mode };
        if (options.agent) {
          runOptions.agents = [options.agent];
        }
        if (options.skipBugDetection) {
          runOptions.skipBugDetection = true;
        }

        console.log(`Running tests for "${options.app}"...`);
        if (options.agent) {
          console.log(`  Agent: ${options.agent}`);
        }
        console.log(`  Mode: ${options.mode}`);
        console.log('');

        const result = await engine.run(options.app, runOptions);

        // Print summary
        console.log('--- Test Run Complete ---');
        console.log(`  Run ID:  ${result.runId || 'N/A'}`);
        console.log(`  Status:  ${result.overallStatus || 'completed'}`);
        if (result.connectorError) {
          console.log(`  Error:   [${result.connectorError.phase}] ${result.connectorError.message}`);
        }
        // Print per-scenario results
        for (const ar of (result.agentResults || [])) {
          if (ar.error) {
            console.log(`  Agent ${ar.agentId} error: ${ar.error.message}`);
          }
          if (ar.scenarios && ar.scenarios.length > 0) {
            console.log(`\n  Agent: ${ar.agentId}`);
            for (const sc of ar.scenarios) {
              const icon = sc.status === 'passed' ? '✅' : sc.status === 'skipped_dependency' ? '⏭️' : '❌';
              const dur = sc.durationMs ? ` (${sc.durationMs}ms)` : '';
              console.log(`    ${icon} ${sc.scenarioId}: ${sc.status}${dur}`);
              if (sc.status === 'failed' || sc.status === 'error') {
                for (const fs of (sc.failedSteps || [])) {
                  console.log(`       Step ${fs.stepIndex} [${fs.action}]: ${fs.error?.message || 'failed'}`);
                }
                for (const fa of (sc.failedAssertions || [])) {
                  console.log(`       Assertion: ${fa.message || fa.type} — expected: ${fa.expected}, actual: ${fa.actual}`);
                }
                if (sc.error) {
                  console.log(`       Error: ${sc.error.message || sc.error}`);
                }
              }
            }
          }
        }
        const s = result.summary || {};
        console.log(`  Total:   ${s.totalScenarios || 0}`);
        console.log(`  Passed:  ${s.passedScenarios || 0}`);
        console.log(`  Failed:  ${s.failedScenarios || 0}`);
        console.log(`  Skipped: ${s.skippedScenarios || 0}`);

        if (result.bugs && result.bugs.length > 0) {
          console.log(`  Bugs:    ${result.bugs.length} created`);
        }

        // Exit with non-zero if failures
        const exitCode = (s.failedScenarios || 0) > 0 ? 1 : 0;
        await engine.shutdown();
        process.exit(exitCode);

      } catch (err) {
        console.error(`Error: ${err.message}`);
        if (engine) await engine.shutdown();
        process.exit(2);
      }
    });
};
