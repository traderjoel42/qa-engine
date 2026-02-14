#!/usr/bin/env node

/**
 * Send a test WhatsApp notification to verify Twilio configuration.
 * Standalone - does not depend on test run infrastructure.
 *
 * Uses env var names matching core/config.js:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER,
 *   QA_ENGINE_NOTIFICATION_RECIPIENTS
 */

require('dotenv').config();
const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const from = process.env.TWILIO_FROM_NUMBER;
const recipients = process.env.QA_ENGINE_NOTIFICATION_RECIPIENTS;

// Validate all required vars
const missing = [];
if (!accountSid) missing.push('TWILIO_ACCOUNT_SID');
if (!authToken) missing.push('TWILIO_AUTH_TOKEN');
if (!from) missing.push('TWILIO_FROM_NUMBER');
if (!recipients) missing.push('QA_ENGINE_NOTIFICATION_RECIPIENTS');

if (missing.length > 0) {
  console.error(`\u274c Missing environment variables: ${missing.join(', ')}`);
  console.error('   Check .env file \u2014 var names must match core/config.js');
  process.exit(1);
}

// QA_ENGINE_NOTIFICATION_RECIPIENTS is comma-separated; use the first one
const to = recipients.split(',')[0].trim();

console.log(`Sending test notification...`);
console.log(`  From: ${from}`);
console.log(`  To:   ${to}`);

const client = twilio(accountSid, authToken);

client.messages
  .create({
    body: [
      '\ud83e\uddea *QA Engine \u2014 Connection Test*',
      '',
      'If you can read this, WhatsApp notifications are working.',
      '',
      `Sent: ${new Date().toISOString()}`,
      `Host: Mac Mini`,
      `Target: Brainstormy Staging`
    ].join('\n'),
    from: from,
    to: to
  })
  .then((message) => {
    console.log(`\n\u2705 Message sent successfully`);
    console.log(`   SID: ${message.sid}`);
    console.log(`   Status: ${message.status}`);
    console.log('\n\ud83d\udcf1 Check your phone for the WhatsApp message.');
  })
  .catch((err) => {
    console.error(`\n\u274c Failed to send message: ${err.message}`);

    if (err.code === 20003) {
      console.error('   Auth failed \u2014 check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
    } else if (err.code === 21608) {
      console.error('   Unverified recipient \u2014 send "join <sandbox-keyword>" from WhatsApp to Twilio number first');
    } else if (err.code === 21211) {
      console.error('   Invalid "to" number \u2014 check QA_ENGINE_NOTIFICATION_RECIPIENTS format');
      console.error('   Should be: whatsapp:+1234567890');
    }

    process.exit(1);
  });
