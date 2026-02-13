require('dotenv').config();

console.log('🧪 Testing QA Engine Setup\n');

// Test 1: Environment variables loaded
console.log('1. Environment Variables:');
console.log('   ✓ ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? 'Found' : '✗ Missing');
console.log('   ✓ LINEAR_API_KEY:', process.env.LINEAR_API_KEY ? 'Found' : '✗ Missing');
console.log('   ✓ TWILIO_ACCOUNT_SID:', process.env.TWILIO_ACCOUNT_SID ? 'Found' : '✗ Missing');
console.log('   ✓ BRAINSTORMY_TEST_USER:', process.env.BRAINSTORMY_TEST_USER || '✗ Missing');

// Test 2: Dependencies installed
console.log('\n2. Dependencies:');
try {
  require('@anthropic-ai/sdk');
  console.log('   ✓ Anthropic SDK installed');
} catch (e) {
  console.log('   ✗ Anthropic SDK missing');
}

try {
  require('playwright');
  console.log('   ✓ Playwright installed');
} catch (e) {
  console.log('   ✗ Playwright missing');
}

try {
  require('better-sqlite3');
  console.log('   ✓ SQLite installed');
} catch (e) {
  console.log('   ✗ SQLite missing');
}

console.log('\n✅ Setup verification complete!\n');
