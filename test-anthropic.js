require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

async function test() {
  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Say "API works"' }]
    });
    console.log('✅ Anthropic:', message.content[0].text);
  } catch (error) {
    console.error('❌ Anthropic error:', error.message);
  }
}

test();
