#!/usr/bin/env node
'use strict';

// Load .env before anything else
try {
  require('dotenv').config();
} catch (err) {
  // dotenv is optional — env vars can come from the shell
}

const { Command } = require('commander');
const testCommand = require('./commands/test');
const statusCommand = require('./commands/status');
const bugsCommand = require('./commands/bugs');

const program = new Command();

program
  .name('qa-engine')
  .description('AI-powered QA automation engine')
  .version('0.1.0');

testCommand(program);
statusCommand(program);
bugsCommand(program);

program.parse(process.argv);
