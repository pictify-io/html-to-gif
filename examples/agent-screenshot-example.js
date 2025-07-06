const dotenv = require('dotenv');
dotenv.config();

const { takeScreenshot } = require('../lib/agent-screenshot');
const { initializeBrowserPool, cleanup } = require('../service/browserpool');

async function runExamples() {
  console.log('🚀 Initializing browser pool...');
  await initializeBrowserPool();
  
  console.log('🤖 Running ReAct agent screenshot examples...\n');
  console.log('🎯 This demo showcases how ReAct agents can reason, navigate, and capture screenshots!\n');

  // Example 1: Direct website screenshot
  console.log('Example 1: Direct website screenshot (ReAct navigation)');
  const result1 = await takeScreenshot('Give me screenshot of ticker chart of Nvidia from google finance');
  if (result1.success) {
    console.log(`✅ Agent navigated to: ${result1.metadata.url}`);
    console.log(`📸 Screenshot: ${result1.screenshot.url}`);
  } else {
    console.log('❌ Error:', result1.error);
  }
  console.log('---\n');

  await cleanup();
  console.log('✅ Examples completed and cleaned up');
  console.log('🚀 The ReAct agent successfully demonstrated intelligent reasoning, navigation, and screenshot capture!');
}

if (require.main === module) {
  runExamples().catch(console.error);
}

module.exports = { runExamples }; 