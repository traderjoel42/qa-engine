#!/bin/bash
# Set up the QA Engine scheduler.
# Seeds default schedules and starts the scheduler process.

set -e

echo "📅 QA Engine: Setting up scheduler..."

# Run database initialization (which runs Migrator.migrate() automatically)
# This applies any pending migrations including 002_scheduled_runs.sql
node -e "
const { createDatabase } = require('./core/database');
const db = createDatabase();
console.log('Database initialized and migrations applied.');
"

# Seed default schedules
node -e "
const { createDatabase } = require('./core/database');
const db = createDatabase();
const scheduledRuns = db.scheduledRuns;

// Check if already seeded
const existing = scheduledRuns.getAll();
if (existing.length > 0) {
  console.log('Schedules already exist, skipping seed.');
  process.exit(0);
}

// Seed defaults using the repository
scheduledRuns.create({
  id: 'sched-nightly-full',
  app_id: 'brainstormy',
  name: 'Nightly Full Suite',
  cron_expression: '0 2 * * *',
  test_mode: 'full',
  agents: JSON.stringify(['healer', 'sentinel', 'librarian']),
  environment: 'staging',
  enabled: 1,
  notify_on_complete: 1
});

scheduledRuns.create({
  id: 'sched-weekly-regression',
  app_id: 'brainstormy',
  name: 'Weekly Regression',
  cron_expression: '0 3 * * 0',
  test_mode: 'regression',
  agents: JSON.stringify(['healer', 'sentinel', 'librarian']),
  environment: 'staging',
  enabled: 1,
  notify_on_complete: 1
});

scheduledRuns.create({
  id: 'sched-daily-digest',
  app_id: 'brainstormy',
  name: 'Daily Digest',
  cron_expression: '0 8 * * *',
  test_mode: 'digest',
  agents: JSON.stringify([]),
  environment: 'staging',
  enabled: 1,
  notify_on_complete: 1
});

console.log('Default schedules seeded.');
"

echo "✅ Scheduler setup complete."
echo "   Start with: npm run start:scheduler"
