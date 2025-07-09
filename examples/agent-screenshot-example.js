const axios = require('axios');

// Example of using the agent screenshot endpoint
async function testAgentScreenshot() {
  try {
    // Configuration
    const API_BASE_URL = 'http://localhost:3000'; // Adjust this to your server URL
    const API_TOKEN = 'your-api-token'; // Replace with your actual API token

    // Test prompt
    const prompt = "Take a screenshot of the pricing section on slack.com";

    console.log('🚀 Testing agent screenshot endpoint...');
    console.log('Prompt:', prompt);

    const response = await axios.post(`${API_BASE_URL}/image/agent-screenshot`, {
      prompt: prompt
    }, {
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000 // 2 minutes timeout for complex screenshots
    });

    console.log('✅ Success! Response:', {
      url: response.data.url,
      id: response.data.id,
      createdAt: response.data.createdAt,
      metadata: response.data.metadata
    });

    return response.data;
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
    throw error;
  }
}

// Example of testing multiple prompts
async function testMultiplePrompts() {
  const prompts = [
    "Take a screenshot of the hero section on slack.com",
    "Take a screenshot of the pricing table on github.com/pricing",
    "Take a screenshot of the navigation menu on stripe.com",
    "Take a screenshot of the features section on vercel.com"
  ];

  console.log('🧪 Testing multiple prompts...');

  for (const prompt of prompts) {
    try {
      console.log(`\n📝 Testing: "${prompt}"`);
      const result = await testAgentScreenshot();
      console.log(`✅ Screenshot saved: ${result.url}`);
    } catch (error) {
      console.error(`❌ Failed for prompt: "${prompt}"`);
    }
  }
}

// Run the test
if (require.main === module) {
  testAgentScreenshot()
    .then(() => console.log('✅ Test completed successfully'))
    .catch(error => {
      console.error('❌ Test failed:', error);
      process.exit(1);
    });
}

module.exports = { testAgentScreenshot, testMultiplePrompts }; 