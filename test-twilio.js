require('dotenv').config();
const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function testTwilio() {
  try {
    const message = await client.messages.create({
      from: 'whatsapp:' + process.env.TWILIO_WHATSAPP_NUMBER,
      to: 'whatsapp:' + process.env.JOEL_PHONE_NUMBER,
      body: '✅ QA Engine WhatsApp test - API connection works!'
    });
    
    console.log('✅ Twilio message sent!');
    console.log('   Message SID:', message.sid);
    console.log('   Check your WhatsApp!');
  } catch (error) {
    console.error('❌ Twilio error:', error.message);
  }
}

testTwilio();
