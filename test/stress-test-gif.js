const axios = require('axios');
const fs = require('fs');
const pidusage = require('pidusage');
const os = require('os');

// Realistic test HTML for GIF generation
const testScenarios = {
  simple: `
<!DOCTYPE html>
<html>
<head>
  <style>
    .box {
      width: 100px;
      height: 100px;
      background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
      animation: move 2s infinite;
    }
    @keyframes move {
      0% { transform: translateX(0) rotate(0deg); }
      50% { transform: translateX(200px) rotate(180deg); }
      100% { transform: translateX(0) rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="box"></div>
</body>
</html>`,

  complex: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; padding: 20px; background: #1a1a2e; }
    .container { display: flex; gap: 20px; flex-wrap: wrap; }
    .card {
      width: 150px;
      height: 150px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 10px;
      animation: float 3s ease-in-out infinite;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    }
    @keyframes float {
      0%, 100% { transform: translateY(0) scale(1); }
      50% { transform: translateY(-20px) scale(1.05); }
    }
    .card:nth-child(2) { animation-delay: 0.5s; }
    .card:nth-child(3) { animation-delay: 1s; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card"></div>
    <div class="card"></div>
    <div class="card"></div>
  </div>
</body>
</html>`
};

// Test Configuration
const config = {
  baseUrl: 'http://localhost:3000',
  apiToken: process.env.API_TOKEN || 'your-test-token',
  
  // Test scenarios - Adjusted for t3.medium (2 vCPU, 4GB RAM)
  scenarios: [
    {
      name: 'Light Load (Average) - t3.medium',
      concurrent: 2,
      totalRequests: 20,
      duration: 60, // seconds
    },
    {
      name: 'Medium Load (2x Average) - t3.medium',
      concurrent: 3,
      totalRequests: 30,
      duration: 120,
    },
    {
      name: 'Heavy Load (5x Average) - t3.medium',
      concurrent: 5,
      totalRequests: 50,
      duration: 180,
    },
    {
      name: 'Peak Load (10x Average) - t3.medium',
      concurrent: 8,
      totalRequests: 80,
      duration: 300,
    },
    {
      name: 'Sustained Load (1 hour) - t3.medium',
      concurrent: 3,
      totalRequests: 180,
      duration: 3600,
    }
  ],
  
  selectedScenario: 0, // Change this to test different scenarios
  
  monitoringInterval: 2000,
  requestTimeout: 120000, // 2 minutes per request
  
  // Thresholds - Configured for AWS t3.medium (2 vCPU, 4GB RAM)
  thresholds: {
    maxMemoryMB: 3200, // 3.2GB (80% of 4GB, leave room for OS)
    maxCpuPercent: 85, // Lower for t3 burstable CPU credits
    maxP95ResponseTime: 35000, // 35 seconds (slightly higher for 2 vCPU)
    minSuccessRate: 95, // 95%
  },
  
  // Instance info
  instanceType: 't3.medium',
  instanceSpecs: {
    vCPUs: 2,
    ramGB: 4,
    architecture: 'x86_64',
    cpuType: 'Burstable (with CPU credits)',
  }
};

// Metrics collection
const metrics = {
  requests: {
    total: 0,
    successful: 0,
    failed: 0,
    timeouts: 0,
  },
  responseTimes: [],
  errors: {},
  startTime: null,
  endTime: null,
  resourceSnapshots: [],
};

// Monitor system resources
async function monitorResources(serverPid) {
  try {
    const stats = await pidusage(serverPid);
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const cpuCount = os.cpus().length;

    const snapshot = {
      timestamp: Date.now(),
      cpu: stats.cpu,
      cpuCount,
      memory: stats.memory / 1024 / 1024, // MB
      memoryPercent: (stats.memory / totalMem) * 100,
      systemMemoryUsed: usedMem / 1024 / 1024, // MB
      systemMemoryFree: freeMem / 1024 / 1024, // MB
      loadAverage: os.loadavg(),
    };

    metrics.resourceSnapshots.push(snapshot);

    console.log(`\n[${new Date().toISOString()}] System Resources:`);
    console.log(`  CPU: ${snapshot.cpu.toFixed(2)}% (${cpuCount} cores)`);
    console.log(`  Process Memory: ${snapshot.memory.toFixed(2)} MB`);
    console.log(`  System Memory: ${((usedMem / totalMem) * 100).toFixed(2)}% used`);
    console.log(`  Load Avg: ${snapshot.loadAverage.map(x => x.toFixed(2)).join(', ')}`);
    console.log(`  Requests: ${metrics.requests.successful}/${metrics.requests.total} successful`);

    // Check thresholds
    const warnings = [];
    if (snapshot.memory > config.thresholds.maxMemoryMB) {
      warnings.push(`Memory exceeded ${config.thresholds.maxMemoryMB}MB`);
    }
    if (snapshot.cpu > config.thresholds.maxCpuPercent) {
      warnings.push(`CPU exceeded ${config.thresholds.maxCpuPercent}%`);
    }

    if (warnings.length > 0) {
      console.warn('  ⚠️  WARNINGS:', warnings.join(', '));
    }

    return warnings.length === 0;
  } catch (err) {
    console.error('Error monitoring resources:', err.message);
    return true;
  }
}

// Check health endpoint
async function checkHealth() {
  try {
    const response = await axios.get(`${config.baseUrl}/gif/health`, {
      timeout: 5000
    });
    
    console.log('\n📊 Health Check:');
    console.log('  Status:', response.data.status);
    console.log('  Browser Pool:', JSON.stringify(response.data.browserPool, null, 2));
    console.log('  Page Pool:', JSON.stringify(response.data.pagePool, null, 2));
    console.log('  Memory:', JSON.stringify(response.data.memory, null, 2));
    
    return response.data;
  } catch (err) {
    console.error('Health check failed:', err.message);
    return null;
  }
}

// Generate a single GIF
async function generateGif(html, endpoint = 'public') {
  const startTime = Date.now();
  metrics.requests.total++;

  try {
    const url = `${config.baseUrl}/gif/${endpoint}`;
    const payload = {
      html,
      width: 800,
      height: 600,
      framesPerSecond: 18,
    };

    const headers = endpoint !== 'public' 
      ? { 'Authorization': `Bearer ${config.apiToken}` }
      : {};

    const response = await axios.post(url, payload, {
      headers,
      timeout: config.requestTimeout,
    });

    const responseTime = Date.now() - startTime;
    metrics.responseTimes.push(responseTime);
    metrics.requests.successful++;

    return {
      success: true,
      responseTime,
      data: response.data,
    };
  } catch (err) {
    const responseTime = Date.now() - startTime;
    
    if (err.code === 'ECONNABORTED') {
      metrics.requests.timeouts++;
    } else {
      metrics.requests.failed++;
      const errorKey = err.response?.status || err.code || 'unknown';
      metrics.errors[errorKey] = (metrics.errors[errorKey] || 0) + 1;
    }

    return {
      success: false,
      responseTime,
      error: err.message,
      status: err.response?.status,
    };
  }
}

// Run concurrent requests
async function runConcurrentRequests(concurrent, total, html) {
  const results = [];
  let completed = 0;
  let inFlight = 0;
  let index = 0;

  return new Promise((resolve) => {
    const checkComplete = () => {
      if (completed >= total) {
        resolve(results);
      }
    };

    const startNext = async () => {
      if (index >= total) return;
      
      const requestIndex = index++;
      inFlight++;

      const result = await generateGif(html);
      results.push(result);
      
      completed++;
      inFlight--;
      
      console.log(`  [${completed}/${total}] ${result.success ? '✓' : '✗'} ${result.responseTime}ms${result.error ? ` - ${result.error}` : ''}`);
      
      checkComplete();
      startNext();
    };

    // Start initial batch
    for (let i = 0; i < Math.min(concurrent, total); i++) {
      startNext();
    }
  });
}

// Calculate statistics
function calculateStats() {
  const sorted = [...metrics.responseTimes].sort((a, b) => a - b);
  const count = sorted.length;

  const stats = {
    requests: metrics.requests,
    responseTimes: {
      min: sorted[0] || 0,
      max: sorted[count - 1] || 0,
      mean: sorted.reduce((a, b) => a + b, 0) / count || 0,
      median: sorted[Math.floor(count / 2)] || 0,
      p95: sorted[Math.floor(count * 0.95)] || 0,
      p99: sorted[Math.floor(count * 0.99)] || 0,
    },
    throughput: {
      requestsPerSecond: 0,
      totalDuration: 0,
    },
    resources: {
      avgCpu: 0,
      maxCpu: 0,
      avgMemory: 0,
      maxMemory: 0,
    },
    errors: metrics.errors,
    successRate: (metrics.requests.successful / metrics.requests.total) * 100,
  };

  // Calculate throughput
  if (metrics.startTime && metrics.endTime) {
    stats.throughput.totalDuration = (metrics.endTime - metrics.startTime) / 1000;
    stats.throughput.requestsPerSecond = metrics.requests.total / stats.throughput.totalDuration;
  }

  // Calculate resource averages
  if (metrics.resourceSnapshots.length > 0) {
    stats.resources.avgCpu = metrics.resourceSnapshots.reduce((a, b) => a + b.cpu, 0) / metrics.resourceSnapshots.length;
    stats.resources.maxCpu = Math.max(...metrics.resourceSnapshots.map(s => s.cpu));
    stats.resources.avgMemory = metrics.resourceSnapshots.reduce((a, b) => a + b.memory, 0) / metrics.resourceSnapshots.length;
    stats.resources.maxMemory = Math.max(...metrics.resourceSnapshots.map(s => s.memory));
  }

  return stats;
}

// Print final report
function printReport(stats, scenario) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 STRESS TEST REPORT');
  console.log('='.repeat(80));
  
  console.log(`\n🖥️  Instance: AWS ${config.instanceType}`);
  console.log(`   vCPUs: ${config.instanceSpecs.vCPUs}`);
  console.log(`   RAM: ${config.instanceSpecs.ramGB}GB`);
  console.log(`   Architecture: ${config.instanceSpecs.architecture}`);
  
  console.log(`\n🎯 Scenario: ${scenario.name}`);
  console.log(`   Concurrent Users: ${scenario.concurrent}`);
  console.log(`   Total Requests: ${scenario.totalRequests}`);
  console.log(`   Duration: ${stats.throughput.totalDuration.toFixed(2)}s`);
  
  console.log('\n📈 Request Statistics:');
  console.log(`   Total: ${stats.requests.total}`);
  console.log(`   Successful: ${stats.requests.successful} (${stats.successRate.toFixed(2)}%)`);
  console.log(`   Failed: ${stats.requests.failed}`);
  console.log(`   Timeouts: ${stats.requests.timeouts}`);
  
  console.log('\n⏱️  Response Times (ms):');
  console.log(`   Min: ${stats.responseTimes.min.toFixed(0)}`);
  console.log(`   Mean: ${stats.responseTimes.mean.toFixed(0)}`);
  console.log(`   Median: ${stats.responseTimes.median.toFixed(0)}`);
  console.log(`   P95: ${stats.responseTimes.p95.toFixed(0)}`);
  console.log(`   P99: ${stats.responseTimes.p99.toFixed(0)}`);
  console.log(`   Max: ${stats.responseTimes.max.toFixed(0)}`);
  
  console.log('\n🚀 Throughput:');
  console.log(`   Requests/second: ${stats.throughput.requestsPerSecond.toFixed(2)}`);
  console.log(`   GIFs/minute: ${(stats.throughput.requestsPerSecond * 60).toFixed(2)}`);
  console.log(`   GIFs/hour: ${(stats.throughput.requestsPerSecond * 3600).toFixed(0)}`);
  console.log(`   GIFs/month (24/7): ${(stats.throughput.requestsPerSecond * 3600 * 24 * 30).toFixed(0)}`);
  console.log(`   Target: 40,000/month`);
  
  const capacityMultiple = (stats.throughput.requestsPerSecond * 3600 * 24 * 30) / 40000;
  const capacityIcon = capacityMultiple >= 1 ? '✅' : '⚠️';
  console.log(`   ${capacityIcon} Capacity: ${capacityMultiple.toFixed(1)}x target`);
  
  console.log('\n💻 Resource Usage:');
  console.log(`   Avg CPU: ${stats.resources.avgCpu.toFixed(2)}%`);
  console.log(`   Max CPU: ${stats.resources.maxCpu.toFixed(2)}%`);
  console.log(`   Avg Memory: ${stats.resources.avgMemory.toFixed(2)} MB`);
  console.log(`   Max Memory: ${stats.resources.maxMemory.toFixed(2)} MB`);
  
  if (Object.keys(stats.errors).length > 0) {
    console.log('\n❌ Errors:');
    Object.entries(stats.errors).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });
  }
  
  console.log('\n✅ Threshold Checks:');
  const checks = [
    {
      name: 'Success Rate',
      value: stats.successRate,
      threshold: config.thresholds.minSuccessRate,
      unit: '%',
      passed: stats.successRate >= config.thresholds.minSuccessRate,
    },
    {
      name: 'P95 Response Time',
      value: stats.responseTimes.p95,
      threshold: config.thresholds.maxP95ResponseTime,
      unit: 'ms',
      passed: stats.responseTimes.p95 <= config.thresholds.maxP95ResponseTime,
    },
    {
      name: 'Max CPU',
      value: stats.resources.maxCpu,
      threshold: config.thresholds.maxCpuPercent,
      unit: '%',
      passed: stats.resources.maxCpu <= config.thresholds.maxCpuPercent,
    },
    {
      name: 'Max Memory',
      value: stats.resources.maxMemory,
      threshold: config.thresholds.maxMemoryMB,
      unit: 'MB',
      passed: stats.resources.maxMemory <= config.thresholds.maxMemoryMB,
    },
  ];
  
  let allPassed = true;
  checks.forEach(check => {
    const icon = check.passed ? '✅' : '❌';
    console.log(`   ${icon} ${check.name}: ${check.value.toFixed(2)}${check.unit} (threshold: ${check.threshold}${check.unit})`);
    if (!check.passed) allPassed = false;
  });
  
  console.log('\n' + '='.repeat(80));
  console.log(allPassed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED');
  console.log('='.repeat(80) + '\n');
  
  return allPassed;
}

// Main stress test
async function runStressTest() {
  console.log('🚀 Starting GIF Generation Stress Test\n');
  
  // Get server PID
  let serverPid;
  try {
    serverPid = parseInt(fs.readFileSync('server.pid', 'utf8'));
    console.log(`📌 Monitoring server PID: ${serverPid}\n`);
  } catch (err) {
    console.error('❌ Could not read server.pid. Make sure the server is running.');
    process.exit(1);
  }
  
  // Check initial health
  console.log('🏥 Checking initial health...');
  await checkHealth();
  
  // Get scenario
  const scenario = config.scenarios[config.selectedScenario];
  console.log(`\n📋 Selected Scenario: ${scenario.name}`);
  console.log(`   Concurrent: ${scenario.concurrent}`);
  console.log(`   Total Requests: ${scenario.totalRequests}`);
  console.log(`   Max Duration: ${scenario.duration}s`);
  
  // Start monitoring
  const monitorInterval = setInterval(() => {
    monitorResources(serverPid);
  }, config.monitoringInterval);
  
  // Run test
  console.log('\n🏃 Starting load test...\n');
  metrics.startTime = Date.now();
  
  try {
    await runConcurrentRequests(
      scenario.concurrent,
      scenario.totalRequests,
      testScenarios.simple
    );
  } catch (err) {
    console.error('\n❌ Test failed:', err);
  } finally {
    metrics.endTime = Date.now();
    clearInterval(monitorInterval);
  }
  
  // Final health check
  console.log('\n🏥 Final health check...');
  await checkHealth();
  
  // Calculate and print stats
  const stats = calculateStats();
  const passed = printReport(stats, scenario);
  
  // Save detailed results
  const resultsFile = `test/results-${Date.now()}.json`;
  fs.writeFileSync(resultsFile, JSON.stringify({
    scenario,
    stats,
    metrics,
    timestamp: new Date().toISOString(),
  }, null, 2));
  console.log(`\n💾 Detailed results saved to: ${resultsFile}\n`);
  
  process.exit(passed ? 0 : 1);
}

// Handle errors
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  process.exit(1);
});

// Run
runStressTest().catch(console.error);

