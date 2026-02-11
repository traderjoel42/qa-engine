require('dotenv').config();

async function testLinear() {
  try {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.LINEAR_API_KEY
      },
      body: JSON.stringify({
        query: '{ viewer { name email } }'
      })
    });
    
    const data = await response.json();
    
    if (data.data?.viewer) {
      console.log('✅ Linear API works!');
      console.log('   User:', data.data.viewer.name);
      console.log('   Email:', data.data.viewer.email);
    } else {
      console.log('❌ Linear API failed:', data.errors);
    }
  } catch (error) {
    console.error('❌ Linear error:', error.message);
  }
}

testLinear();
