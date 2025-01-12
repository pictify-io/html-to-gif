const { exec } = require('child_process');
const os = require('os');
const pidusage = require('pidusage');

// Sample HTML content for testing
const testHTML = `
<!DOCTYPE html>
<html>
<head>
  <style>
    .box {
      width: 100px;
      height: 100px;
      background: red;
      animation: move 2s infinite;
    }
    @keyframes move {
      0% { transform: translateX(0); }
      100% { transform: translateX(200px); }
    }
  </style>
</head>
<body>
  <div class="box"></div>
</body>
</html>
`;

// Configuration
const config = {
  concurrentUsers: 5,     // Reduced from 50 to prevent memory overload
  totalRequests: 100,     // Reduced from 500
  serverUrl: 'http://localhost:3000/image/public',
  monitoringInterval: 1000, // ms
  timeoutSeconds: 120,    // Maximum time to wait for test completion
  maxMemoryMB: 2048      // Maximum memory threshold (2GB)
};

// Enhanced monitoring function
async function monitorResources(serverPid) {
  try {
    const stats = await pidusage(serverPid);
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const cpuCount = os.cpus().length;
    const processMemoryMB = process.memoryUsage().heapTotal / 1024 / 1024;

    console.log('\nSystem Resources:');
    console.log(`CPU Usage: ${stats.cpu.toFixed(2)}% (${cpuCount} cores)`);
    console.log(`Memory Usage: ${(usedMem / totalMem * 100).toFixed(2)}%`);
    console.log(`Used Memory: ${(usedMem / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Free Memory: ${(freeMem / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Process Memory: ${(stats.memory / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Node.js Heap: ${processMemoryMB.toFixed(2)} MB`);
    console.log(`Load Average: ${os.loadavg().map(x => x.toFixed(2)).join(', ')}`);

    // Check if memory exceeds threshold
    if (stats.memory / 1024 / 1024 > config.maxMemoryMB) {
      console.error(`\nWARNING: Memory usage exceeded ${config.maxMemoryMB}MB threshold!`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Error monitoring resources:', err);
    return true;
  }
}

// Function to run Apache Benchmark
function runApacheBenchmark() {
  const command = `ab -n ${config.totalRequests} -c ${config.concurrentUsers} -s ${config.timeoutSeconds} -p test/payload.json -T 'application/json' ${config.serverUrl}`;

  console.log(`Running command: ${command}`);

  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        console.error('Apache Benchmark error:', stderr);
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

// Update main stress test function to handle memory limits
async function runStressTest() {
  const fs = require('fs');
  const payload = JSON.stringify({ html: testHTML });
  fs.writeFileSync('test/payload.json', payload);

  try {
    const serverPid = parseInt(fs.readFileSync('server.pid', 'utf8'));
    console.log('Starting stress test with configuration:');
    console.log(`Concurrent Users: ${config.concurrentUsers}`);
    console.log(`Total Requests: ${config.totalRequests}`);
    console.log(`Server URL: ${config.serverUrl}`);
    console.log(`Memory Limit: ${config.maxMemoryMB}MB`);

    let shouldContinue = true;
    const monitor = setInterval(async () => {
      shouldContinue = await monitorResources(serverPid);
      if (!shouldContinue) {
        console.log('Stopping test due to memory threshold exceeded');
        clearInterval(monitor);
        process.exit(1);
      }
    }, config.monitoringInterval);

    console.log('\nRunning Apache Benchmark...');
    const results = await runApacheBenchmark();
    console.log('\nApache Benchmark Results:');
    console.log(results);

    clearInterval(monitor);
    fs.unlinkSync('test/payload.json');
  } catch (error) {
    console.error('Error running stress test:', error);
    process.exit(1);
  }
}

// Run the stress test
runStressTest().catch(console.error); 