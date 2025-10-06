# Stress Testing Guide

## Overview

This directory contains comprehensive stress testing tools for the GIF generation service.

## Issues with Original Stress Test

The original `stress-test.js` had several problems:

### ❌ **Critical Issues:**

1. **Wrong Endpoint**: Testing `/image/public` instead of `/gif` endpoints
2. **Too Light**: Only 5 concurrent users and 100 requests (insufficient for 40k/month target)
3. **No GIF Testing**: Not testing the optimized `EventDrivenGifRecorder`
4. **Unrealistic Load**: Simple burst test, not sustained load patterns

### ⚠️ **Missing Features:**

- No browser/page pool utilization monitoring
- No rate limit testing
- No health endpoint checking
- No percentile metrics (P95, P99)
- No throughput calculations
- No realistic GIF generation scenarios

---

## New Stress Test Suite

### **stress-test-gif.js** (Comprehensive GIF Testing)

A complete stress testing solution with:

✅ Tests actual GIF endpoints  
✅ Multiple load scenarios (light, medium, heavy, peak, sustained)  
✅ Real-time resource monitoring  
✅ Browser/page pool health checks  
✅ Detailed metrics (P95, P99, throughput)  
✅ Threshold validation  
✅ JSON report generation  

---

## Quick Start

### 1. Install Dependencies

```bash
npm install axios pidusage
```

### 2. Set Up Environment

```bash
# Set your API token if testing authenticated endpoints
export API_TOKEN=your-test-api-token
```

### 3. Start Server

```bash
npm start
# Server should create server.pid file
```

### 4. Run Stress Test

```bash
# Default scenario (Light Load)
node test/stress-test-gif.js

# Or specify scenario in the file
# Edit config.selectedScenario in stress-test-gif.js
```

---

## Test Scenarios

### Scenario 0: Light Load (Average) ✅
```
Concurrent: 2
Total: 20 requests
Expected: ~1 GIF/minute (average monthly load)
Duration: 60s max
```

### Scenario 1: Medium Load (2x Average)
```
Concurrent: 5
Total: 50 requests
Expected: ~2x average load
Duration: 120s max
```

### Scenario 2: Heavy Load (5x Average)
```
Concurrent: 10
Total: 100 requests
Expected: ~5x average load
Duration: 180s max
```

### Scenario 3: Peak Load (10x Average)
```
Concurrent: 20
Total: 200 requests
Expected: 10x average load
Duration: 300s max
```

### Scenario 4: Sustained Load (1 Hour Simulation)
```
Concurrent: 5
Total: 300 requests
Expected: Sustained production load
Duration: 3600s max
```

---

## Configuration

Edit `stress-test-gif.js` to customize:

```javascript
const config = {
  baseUrl: 'http://localhost:3000',
  selectedScenario: 0, // Change this (0-4)
  
  thresholds: {
    maxMemoryMB: 4096,        // Adjust based on server
    maxCpuPercent: 90,        // Adjust based on cores
    maxP95ResponseTime: 30000, // 30 seconds
    minSuccessRate: 95,       // 95%
  }
};
```

---

## Metrics Collected

### Request Metrics
- Total requests
- Successful/Failed/Timeout counts
- Response time distribution (min, mean, median, P95, P99, max)
- Success rate
- Error breakdown by type

### Throughput Metrics
- Requests per second
- GIFs per minute/hour/month
- Total duration

### Resource Metrics
- CPU usage (average and peak)
- Memory usage (average and peak)
- System load average
- Process-level metrics

### Health Metrics
- Browser pool utilization
- Page pool utilization
- Active/available browsers and pages

---

## Reading Results

### Console Output

Real-time monitoring shows:
```
[2025-01-06T10:30:45.123Z] System Resources:
  CPU: 45.23% (8 cores)
  Process Memory: 1234.56 MB
  System Memory: 65.43% used
  Load Avg: 2.45, 2.12, 1.98
  Requests: 15/20 successful
```

### Final Report

Comprehensive summary with:
- Pass/Fail status for each threshold
- Detailed statistics
- Capacity projections
- Recommendations

### JSON Output

Detailed results saved to `test/results-{timestamp}.json`:
```json
{
  "scenario": {...},
  "stats": {...},
  "metrics": {
    "requests": {...},
    "responseTimes": [...],
    "resourceSnapshots": [...]
  }
}
```

---

## Interpreting Results

### ✅ Good Results

```
Success Rate: 99%+ ✅
P95 Response Time: <20s ✅
Max CPU: <80% ✅
Max Memory: <3GB ✅
```

### ⚠️ Warning Signs

```
Success Rate: 90-95% ⚠️
P95 Response Time: 20-30s ⚠️
Max CPU: 80-90% ⚠️
Max Memory: 3-4GB ⚠️
```

### ❌ Failure Indicators

```
Success Rate: <90% ❌
P95 Response Time: >30s ❌
Max CPU: >90% ❌
Max Memory: >4GB ❌
```

---

## Capacity Planning

Use the throughput metrics to project capacity:

### Example Results:
```
Throughput: 2.5 GIFs/second
= 150 GIFs/minute
= 9,000 GIFs/hour
= 216,000 GIFs/day
= 6,480,000 GIFs/month
```

**For 40k GIFs/month target:**
- Required: ~0.015 GIFs/second average
- Headroom: **162x capacity**

---

## Progressive Load Testing

### Phase 1: Validation (Week 1)
```bash
# Run Scenario 0 (Light Load) daily
# Ensure consistent performance
```

### Phase 2: Stress Testing (Week 2)
```bash
# Run Scenarios 1-3
# Identify breaking points
```

### Phase 3: Endurance Testing (Week 3)
```bash
# Run Scenario 4 (Sustained Load)
# Check for memory leaks, degradation
```

### Phase 4: Production Monitoring
```bash
# Continuous monitoring via /gif/health
# Alert on threshold violations
```

---

## Troubleshooting

### High Memory Usage

1. Check browser pool size
2. Verify page recycling (MAX_PAGE_REUSE)
3. Monitor for memory leaks
4. Check S3 upload completion

### High Response Times

1. Check S3 upload speed
2. Verify FFmpeg processing
3. Monitor page acquisition time
4. Check network latency

### Request Failures

1. Check server logs
2. Verify browser pool capacity
3. Test network connectivity
4. Check rate limiting

### Timeouts

1. Increase `requestTimeout` config
2. Check server resources
3. Verify complex animations
4. Monitor browser crashes

---

## Comparison with 40k/month Target

### Daily Breakdown
```
40,000 GIFs/month
= 1,333 GIFs/day
= 55.5 GIFs/hour
= 0.93 GIFs/minute
= 0.0155 GIFs/second
```

### Test Validation

**Light Load Scenario** should easily handle:
- 2 concurrent users
- Sustained rate of 0.02-0.05 GIFs/second
- Should be 2-3x typical load

If this passes, you're good for 40k/month! ✅

---

## Advanced Testing

### Testing Enterprise Endpoint

Modify `generateGif()` function:
```javascript
// Test EventDrivenGifRecorder
const payload = {
  url: 'https://example.com',
  width: 1280,
  height: 720,
  frameDurationSeconds: 3,
  selector: 'body',
};
```

### Testing with Different HTML Complexity

Use `testScenarios.complex` for heavier load:
```javascript
await runConcurrentRequests(
  scenario.concurrent,
  scenario.totalRequests,
  testScenarios.complex  // More complex animations
);
```

### Custom Scenarios

Add your own scenarios:
```javascript
{
  name: 'Custom Peak',
  concurrent: 15,
  totalRequests: 150,
  duration: 240,
}
```

---

## Monitoring in Production

### Health Endpoint

```bash
curl http://localhost:3000/gif/health
```

Returns:
```json
{
  "status": "healthy",
  "browserPool": { "size": 5, "available": 3, "borrowed": 2 },
  "pagePool": { "size": 30, "available": 25, "borrowed": 5 },
  "memory": { "rss": "512.34MB", "heapUsed": "256.12MB" }
}
```

### Automated Monitoring

Create a cron job or monitoring script:
```bash
*/5 * * * * curl -s http://localhost:3000/gif/health | jq .
```

---

## Best Practices

1. **Baseline First**: Run light load before optimizations
2. **Progressive Load**: Gradually increase load
3. **Monitor Resources**: Watch CPU, memory, pools
4. **Test Realistic Scenarios**: Use production-like HTML
5. **Run Multiple Times**: Ensure consistency
6. **Monitor Over Time**: Watch for degradation
7. **Test Different Times**: Peak vs off-peak
8. **Keep Results**: Track improvements over time

---

## What to Test Before Production

- [ ] Light load (Scenario 0) passes consistently
- [ ] Medium load (Scenario 1) passes
- [ ] Peak load (Scenario 3) passes
- [ ] Sustained load (Scenario 4) passes for 1 hour
- [ ] No memory leaks detected
- [ ] P95 response time <20 seconds
- [ ] Success rate >95%
- [ ] Browser/page pool stable
- [ ] S3 uploads successful
- [ ] Error handling works correctly

---

## Recommended Server Specs Based on Results

After running tests, verify server meets requirements:

### If P95 < 15s and CPU < 60%
✅ Current server is adequate

### If P95 = 15-25s and CPU = 60-80%
⚠️ Consider upgrading before hitting 40k/month

### If P95 > 25s or CPU > 80%
❌ Upgrade server before production load

---

## Questions to Answer with Stress Tests

1. ✅ Can the system handle average load (1 GIF/64s)?
2. ✅ Can it handle peak load (10x average)?
3. ✅ What is the maximum sustained throughput?
4. ✅ At what point does the system degrade?
5. ✅ Are browser/page pools sized correctly?
6. ✅ Is there memory leak over extended operation?
7. ✅ What is the failure mode under extreme load?

Run the tests and answer these questions! 🚀

