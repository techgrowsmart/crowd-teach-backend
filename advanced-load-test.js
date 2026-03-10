/**
 * Advanced Load Testing Script
 * Comprehensive testing with multiple scenarios and real-time monitoring
 */

const { runLoadTest, RESULTS, CONFIG } = require('./load-test');
const fs = require('fs');
const path = require('path');

// Advanced test scenarios
const SCENARIOS = {
  PEAK_LOAD: {
    name: 'Peak Load Test',
    users: 150,
    concurrent: 30,
    description: 'Simulates peak traffic conditions'
  },
  SUSTAINED_LOAD: {
    name: 'Sustained Load Test',
    users: 100,
    concurrent: 20,
    duration: 60000,
    description: 'Tests system stability over extended periods'
  },
  BURST_TEST: {
    name: 'Burst Test',
    users: 200,
    concurrent: 50,
    description: 'Tests system response to sudden traffic spikes'
  },
  GRADUAL_RAMPUP: {
    name: 'Gradual Ramp-up Test',
    users: 100,
    concurrent: 5,
    rampupTime: 30000,
    description: 'Gradually increases load to test scalability'
  }
};

// Real-time monitoring
class RealTimeMonitor {
  constructor() {
    this.metrics = {
      timestamp: [],
      activeConnections: [],
      requestsPerSecond: [],
      errorsPerSecond: [],
      memoryUsage: [],
      cpuUsage: []
    };
    this.startTime = Date.now();
    this.requestCount = 0;
    this.errorCount = 0;
  }

  start() {
    this.interval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - this.startTime) / 1000;
      
      this.metrics.timestamp.push(elapsed);
      this.metrics.activeConnections.push(this.getActiveConnections());
      this.metrics.requestsPerSecond.push(this.requestCount / elapsed);
      this.metrics.errorsPerSecond.push(this.errorCount / elapsed);
      
      const memUsage = process.memoryUsage();
      this.metrics.memoryUsage.push({
        rss: memUsage.rss / 1024 / 1024,
        heapUsed: memUsage.heapUsed / 1024 / 1024,
        heapTotal: memUsage.heapTotal / 1024 / 1024
      });
      
      const cpuUsage = process.cpuUsage();
      this.metrics.cpuUsage.push({
        user: cpuUsage.user,
        system: cpuUsage.system
      });
    }, 1000);
  }

  stop() {
    clearInterval(this.interval);
  }

  incrementRequests() {
    this.requestCount++;
  }

  incrementErrors() {
    this.errorCount++;
  }

  getActiveConnections() {
    // This would typically come from server connection tracking
    return Math.floor(Math.random() * 100) + 50; // Simulated
  }

  getMetrics() {
    return this.metrics;
  }
}

// Enhanced user behavior simulation
class UserBehaviorSimulator {
  constructor() {
    this.behaviors = {
      QUICK_LOGIN: { weight: 0.4, actions: ['login', 'verify', 'logout'] },
      BROWSER: { weight: 0.3, actions: ['login', 'browse', 'verify', 'browse', 'logout'] },
      POWER_USER: { weight: 0.2, actions: ['login', 'verify', 'browse', 'verify', 'browse', 'verify', 'logout'] },
      ERROR_PRONE: { weight: 0.1, actions: ['invalid_login', 'login', 'verify', 'logout'] }
    };
  }

  getRandomBehavior() {
    const random = Math.random();
    let cumulative = 0;
    
    for (const [name, behavior] of Object.entries(this.behaviors)) {
      cumulative += behavior.weight;
      if (random <= cumulative) {
        return { name, ...behavior };
      }
    }
    
    return this.behaviors.QUICK_LOGIN;
  }

  simulateUserActions(user, token) {
    const behavior = this.getRandomBehavior();
    return behavior.actions.map(action => this.executeAction(action, user, token));
  }

  executeAction(action, user, token) {
    switch (action) {
      case 'login':
        return this.login(user);
      case 'verify':
        return this.verifyToken(token);
      case 'browse':
        return this.browse(token);
      case 'logout':
        return this.logout(token);
      case 'invalid_login':
        return this.invalidLogin(user);
      default:
        return Promise.resolve({ success: false, action: 'unknown' });
    }
  }

  async login(user) {
    // Implementation would go here
    return { success: true, action: 'login', user: user.email };
  }

  async verifyToken(token) {
    // Implementation would go here
    return { success: true, action: 'verify' };
  }

  async browse(token) {
    // Implementation would go here
    return { success: true, action: 'browse' };
  }

  async logout(token) {
    // Implementation would go here
    return { success: true, action: 'logout' };
  }

  async invalidLogin(user) {
    // Implementation would go here
    return { success: false, action: 'invalid_login', user: user.email };
  }
}

// Advanced reporting
class AdvancedReporter {
  constructor() {
    this.testResults = [];
    this.comparison = {};
  }

  addTestResult(scenario, results) {
    this.testResults.push({
      scenario: scenario.name,
      timestamp: new Date().toISOString(),
      ...results
    });
  }

  generateComparisonReport() {
    if (this.testResults.length < 2) {
      return 'Insufficient data for comparison';
    }

    let comparison = '\nSCENARIO COMPARISON:\n';
    comparison += '=' .repeat(50) + '\n\n';

    this.testResults.forEach((result, index) => {
      comparison += `${index + 1}. ${result.scenario}\n`;
      comparison += `   Success Rate: ${result.successRate || 'N/A'}%\n`;
      comparison += `   Avg Response Time: ${result.avgResponseTime || 'N/A'}ms\n`;
      comparison += `   Throughput: ${result.throughput || 'N/A'} req/s\n\n`;
    });

    return comparison;
  }

  generateDetailedReport() {
    let report = '\nADVANCED LOAD TESTING REPORT\n';
    report += '=' .repeat(50) + '\n\n';

    this.testResults.forEach((result, index) => {
      report += `TEST SCENARIO ${index + 1}: ${result.scenario}\n`;
      report += '-' .repeat(30) + '\n';
      report += `Timestamp: ${result.timestamp}\n`;
      report += `Users: ${result.users || 'N/A'}\n`;
      report += `Concurrent: ${result.concurrent || 'N/A'}\n`;
      report += `Duration: ${result.duration || 'N/A'}ms\n`;
      report += `Success Rate: ${result.successRate || 'N/A'}%\n`;
      report += `Avg Response Time: ${result.avgResponseTime || 'N/A'}ms\n`;
      report += `95th Percentile: ${result.p95ResponseTime || 'N/A'}ms\n`;
      report += `Throughput: ${result.throughput || 'N/A'} req/s\n`;
      report += `Errors: ${result.errors || 'N/A'}\n\n`;
    });

    report += this.generateComparisonReport();
    report += '\n' + '=' .repeat(50) + '\n';
    report += `Report Generated: ${new Date().toISOString()}\n`;

    return report;
  }

  saveReport(filename) {
    const report = this.generateDetailedReport();
    fs.writeFileSync(filename, report);
    console.log(`📄 Advanced report saved: ${filename}`);
  }
}

// Performance benchmarking
class PerformanceBenchmark {
  constructor() {
    this.benchmarks = {
      responseTime: { excellent: 200, good: 500, acceptable: 1000 },
      throughput: { excellent: 1000, good: 500, acceptable: 200 },
      errorRate: { excellent: 0.01, good: 0.05, acceptable: 0.1 }
    };
  }

  evaluate(results) {
    const evaluation = {
      overall: 'EXCELLENT',
      details: {}
    };

    // Evaluate response time
    if (results.avgResponseTime <= this.benchmarks.responseTime.excellent) {
      evaluation.details.responseTime = 'EXCELLENT';
    } else if (results.avgResponseTime <= this.benchmarks.responseTime.good) {
      evaluation.details.responseTime = 'GOOD';
    } else if (results.avgResponseTime <= this.benchmarks.responseTime.acceptable) {
      evaluation.details.responseTime = 'ACCEPTABLE';
    } else {
      evaluation.details.responseTime = 'POOR';
    }

    // Evaluate throughput
    if (results.throughput >= this.benchmarks.throughput.excellent) {
      evaluation.details.throughput = 'EXCELLENT';
    } else if (results.throughput >= this.benchmarks.throughput.good) {
      evaluation.details.throughput = 'GOOD';
    } else if (results.throughput >= this.benchmarks.throughput.acceptable) {
      evaluation.details.throughput = 'ACCEPTABLE';
    } else {
      evaluation.details.throughput = 'POOR';
    }

    // Evaluate error rate
    const errorRate = results.errors / results.totalRequests;
    if (errorRate <= this.benchmarks.errorRate.excellent) {
      evaluation.details.errorRate = 'EXCELLENT';
    } else if (errorRate <= this.benchmarks.errorRate.good) {
      evaluation.details.errorRate = 'GOOD';
    } else if (errorRate <= this.benchmarks.errorRate.acceptable) {
      evaluation.details.errorRate = 'ACCEPTABLE';
    } else {
      evaluation.details.errorRate = 'POOR';
    }

    // Calculate overall rating
    const scores = Object.values(evaluation.details).map(rating => {
      switch (rating) {
        case 'EXCELLENT': return 4;
        case 'GOOD': return 3;
        case 'ACCEPTABLE': return 2;
        case 'POOR': return 1;
        default: return 0;
      }
    });

    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    
    if (avgScore >= 3.5) evaluation.overall = 'EXCELLENT';
    else if (avgScore >= 2.5) evaluation.overall = 'GOOD';
    else if (avgScore >= 1.5) evaluation.overall = 'ACCEPTABLE';
    else evaluation.overall = 'POOR';

    return evaluation;
  }
}

// Main advanced load test runner
async function runAdvancedLoadTest() {
  console.log('🚀 Starting Advanced Load Testing Suite...\n');

  const monitor = new RealTimeMonitor();
  const simulator = new UserBehaviorSimulator();
  const reporter = new AdvancedReporter();
  const benchmark = new PerformanceBenchmark();

  monitor.start();

  try {
    // Run each scenario
    for (const [scenarioName, scenario] of Object.entries(SCENARIOS)) {
      console.log(`\n📊 Running ${scenario.name}...`);
      console.log(`   ${scenario.description}`);
      
      // Update config for this scenario
      const originalConfig = { ...CONFIG };
      CONFIG.NUM_USERS = scenario.users;
      CONFIG.CONCURRENT_REQUESTS = scenario.concurrent;
      
      // Run the test
      await runLoadTest();
      
      // Calculate additional metrics
      const testDuration = new Date(RESULTS.endTime) - new Date(RESULTS.startTime);
      const successRate = ((RESULTS.loginSuccesses / CONFIG.NUM_USERS) * 100).toFixed(2);
      const throughput = (RESULTS.successfulRequests / (testDuration / 1000)).toFixed(2);
      
      const scenarioResults = {
        users: scenario.users,
        concurrent: scenario.concurrent,
        duration: testDuration,
        successRate: successRate,
        avgResponseTime: RESULTS.responseTimes.reduce((a, b) => a + b, 0) / RESULTS.responseTimes.length,
        throughput: throughput,
        errors: RESULTS.errors.length,
        totalRequests: RESULTS.totalRequests
      };

      // Evaluate performance
      const evaluation = benchmark.evaluate(scenarioResults);
      scenarioResults.evaluation = evaluation;

      // Add to reporter
      reporter.addTestResult(scenario, scenarioResults);
      
      console.log(`   ✅ ${scenario.name} completed`);
      console.log(`   📈 Success Rate: ${successRate}%`);
      console.log(`   ⚡ Throughput: ${throughput} req/s`);
      console.log(`   🏆 Performance: ${evaluation.overall}`);
      
      // Reset config for next scenario
      Object.assign(CONFIG, originalConfig);
      
      // Brief pause between scenarios
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Generate comprehensive report
    console.log('\n📄 Generating comprehensive report...');
    reporter.saveReport('advanced_load_balancing_test.txt');
    
    // Generate comparison charts data
    generateChartData(reporter.testResults);

  } catch (error) {
    console.error('❌ Advanced load test failed:', error);
  } finally {
    monitor.stop();
  }
}

// Generate chart data for visualization
function generateChartData(testResults) {
  const chartData = {
    scenarios: testResults.map(r => r.scenario),
    successRates: testResults.map(r => parseFloat(r.successRate)),
    responseTimes: testResults.map(r => r.avgResponseTime),
    throughputs: testResults.map(r => parseFloat(r.throughput)),
    errors: testResults.map(r => r.errors)
  };

  fs.writeFileSync('load_test_chart_data.json', JSON.stringify(chartData, null, 2));
  console.log('📊 Chart data saved: load_test_chart_data.json');
}

// Run if called directly
if (require.main === module) {
  runAdvancedLoadTest().catch(console.error);
}

module.exports = {
  runAdvancedLoadTest,
  SCENARIOS,
  RealTimeMonitor,
  UserBehaviorSimulator,
  AdvancedReporter,
  PerformanceBenchmark
};
