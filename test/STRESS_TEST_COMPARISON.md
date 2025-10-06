# Stress Test Comparison

## ❌ Original Test (`stress-test.js`) - Issues

### Critical Problems:

1. **Wrong Endpoint** 🚨
   ```javascript
   serverUrl: 'http://localhost:3000/image/public'
   // Testing IMAGE endpoint, not GIF endpoint!
   ```

2. **Too Light for 40k/month** 📉
   ```javascript
   concurrentUsers: 5
   totalRequests: 100
   // Only tests 100 images with 5 concurrent
   // Not representative of sustained GIF generation load
   ```

3. **No GIF-Specific Testing** 🎯
   ```javascript
   // Uses simple HTML
   // Doesn't test:
   // - EventDrivenGifRecorder
   // - FFmpeg encoding
   // - Animation capture
   // - S3 upload of large files
   ```

4. **Missing Metrics** 📊
   ```javascript
   // No tracking of:
   // - Response time percentiles (P95, P99)
   // - Throughput calculations
   // - Browser/page pool utilization
   // - Generation vs upload time breakdown
   ```

5. **No Realistic Scenarios** 🎬
   ```javascript
   // Only burst test
   // Doesn't simulate:
   // - Sustained production load
   // - Peak load patterns
   // - Gradual ramp-up
   ```

---

## ✅ New Test (`stress-test-gif.js`) - Improvements

### What's Better:

#### 1. **Correct Endpoints** ✅
```javascript
// Tests actual GIF generation
url: `${config.baseUrl}/gif/public`
// Can also test enterprise endpoint
```

#### 2. **Multiple Scenarios** 📈
```javascript
scenarios: [
  { name: 'Light Load', concurrent: 2, totalRequests: 20 },
  { name: 'Medium Load', concurrent: 5, totalRequests: 50 },
  { name: 'Heavy Load', concurrent: 10, totalRequests: 100 },
  { name: 'Peak Load', concurrent: 20, totalRequests: 200 },
  { name: 'Sustained', concurrent: 5, totalRequests: 300 },
]
```

#### 3. **Comprehensive Metrics** 📊
```javascript
// Tracks:
- Response times (min, mean, median, P95, P99, max)
- Success/failure/timeout counts
- Throughput (GIFs/second, /minute, /hour, /month)
- Resource usage (CPU, memory, load)
- Browser/page pool utilization
- Error breakdown by type
```

#### 4. **Health Monitoring** 🏥
```javascript
// Checks /gif/health endpoint
// Shows:
- Browser pool stats
- Page pool stats  
- Memory usage
- System status
```

#### 5. **Threshold Validation** ✅
```javascript
thresholds: {
  maxMemoryMB: 4096,
  maxCpuPercent: 90,
  maxP95ResponseTime: 30000,
  minSuccessRate: 95,
}
// Automatically validates and reports pass/fail
```

#### 6. **Realistic Load Testing** 🎬
```javascript
// Tests with actual GIF generation:
- CSS animations
- Multiple complexity levels
- Real FFmpeg encoding
- S3 uploads
- Browser rendering
```

#### 7. **Detailed Reporting** 📝
```javascript
// Generates:
- Real-time console monitoring
- Comprehensive final report
- JSON file with all metrics
- Capacity projections
```

---

## Side-by-Side Comparison

| Feature | Old Test | New Test |
|---------|----------|----------|
| **Endpoint** | ❌ Image | ✅ GIF |
| **Load Levels** | ❌ 1 (5c/100r) | ✅ 5 scenarios |
| **Concurrent Max** | ❌ 5 | ✅ 20 |
| **Total Requests** | ❌ 100 | ✅ Up to 300 |
| **Percentiles** | ❌ No | ✅ P95, P99 |
| **Throughput** | ❌ No | ✅ Yes |
| **Pool Monitoring** | ❌ No | ✅ Yes |
| **Health Checks** | ❌ No | ✅ Yes |
| **Thresholds** | ❌ Memory only | ✅ 4 metrics |
| **Scenarios** | ❌ Burst only | ✅ Sustained load |
| **JSON Export** | ❌ No | ✅ Yes |
| **Error Tracking** | ❌ Basic | ✅ Detailed |
| **Time to Run** | ~30s | 60s-3600s |

---

## What the Old Test Would Miss

### 1. **Actual Production Load**
```
Old test: 100 images in burst
Real need: 40,000 GIFs/month sustained
```

### 2. **GIF-Specific Bottlenecks**
```
- FFmpeg encoding time
- Animation capture overhead
- Large file S3 uploads
- Browser animation rendering
```

### 3. **Resource Exhaustion**
```
- Memory leaks from page reuse
- Browser pool saturation
- S3 connection pool limits
- FFmpeg process accumulation
```

### 4. **Real Failure Modes**
```
- What happens at 10 concurrent?
- When does it start failing?
- Where is the bottleneck?
- How does it degrade?
```

---

## Why Original Test is Insufficient for 40k/month

### Math:
```
40,000 GIFs/month = 1,333/day = 55.5/hour = 0.93/minute

Old test: 100 requests in burst
- Tests ~2 minutes of peak load
- Doesn't test sustained operation
- Wrong endpoint (images vs GIFs)
```

### What You Need:
```
✅ Test sustained load over 1+ hours
✅ Test at 10x expected peak (Scenario 3)
✅ Monitor resource usage over time
✅ Verify no degradation
✅ Test actual GIF generation
```

---

## Recommended Testing Strategy

### Week 1: Baseline
```bash
# Run Scenario 0 (Light Load)
node test/stress-test-gif.js

# Verify:
- 100% success rate
- P95 < 20s
- Memory stable
- No errors
```

### Week 2: Stress
```bash
# Run Scenarios 1-3
# Change config.selectedScenario

# Find:
- Maximum capacity
- Breaking point
- Bottlenecks
```

### Week 3: Endurance
```bash
# Run Scenario 4 (1 hour)
# Monitor for:
- Memory leaks
- Performance degradation
- Resource accumulation
```

### Production: Monitor
```bash
# Continuous health monitoring
curl http://localhost:3000/gif/health

# Alert on:
- High memory (>80%)
- High CPU (>80%)
- Pool saturation (>80%)
- Error rate (>5%)
```

---

## Quick Start: Replace Old Test

### 1. Install Dependencies
```bash
npm install axios pidusage
```

### 2. Run New Test
```bash
# Instead of old test:
# node test/stress-test.js

# Use new test:
node test/stress-test-gif.js
```

### 3. Review Results
```bash
# Check console output for:
- Success rate >95%
- P95 response time <30s
- Max memory <4GB
- Max CPU <90%

# Review JSON file:
cat test/results-*.json | jq .
```

---

## Expected Results for 40k/month

### Scenario 0 (Light Load)
```
✅ Should EASILY pass
Success Rate: 100%
P95 Time: 10-15s
CPU: 20-40%
Memory: 1-2GB
```

### Scenario 3 (Peak - 10x Load)
```
✅ Should pass comfortably
Success Rate: 95%+
P95 Time: 20-25s
CPU: 60-80%
Memory: 2-3GB
```

### Scenario 4 (1 Hour Sustained)
```
✅ Should complete without degradation
Success Rate: 98%+
P95 Time: stable over time
Memory: no leaks
CPU: stable average
```

If all scenarios pass, you're ready for production! 🚀

---

## Bottom Line

**Original Test:**
- ❌ Tests wrong endpoint
- ❌ Too light (5c/100r)
- ❌ Missing key metrics
- ❌ No production scenarios
- ⏱️ Run time: ~30 seconds

**New Test:**
- ✅ Tests GIF generation
- ✅ Multiple scenarios (up to 20c/300r)
- ✅ Comprehensive metrics
- ✅ Sustained load testing
- ⏱️ Run time: 1-60 minutes

**Recommendation:** Use `stress-test-gif.js` for production validation!

