import { EPGErrorHandler } from '../EPGErrorHandler.js'

export class PerformanceMonitor {
  constructor() {
    this.metrics = new Map()
    this.startTimes = new Map()
    this.isEnabled = true
  }

  enable() {
    this.isEnabled = true
  }

  disable() {
    this.isEnabled = false
  }

  startTimer(name) {
    if (!this.isEnabled) return

    this.startTimes.set(name, process.hrtime.bigint())
  }

  endTimer(name) {
    if (!this.isEnabled) return

    const startTime = this.startTimes.get(name)
    if (!startTime) {
      EPGErrorHandler.warn(`No start time found for timer: ${name}`)
      return 0
    }

    const endTime = process.hrtime.bigint()
    const duration = Number((endTime - startTime) / BigInt(1000000)) // Convert to milliseconds safely

    this.startTimes.delete(name)
    this.recordMetric(name, duration)

    return duration
  }

  recordMetric(name, value, unit = 'ms') {
    if (!this.isEnabled) return

    if (!this.metrics.has(name)) {
      this.metrics.set(name, {
        count: 0,
        total: 0,
        min: Infinity,
        max: -Infinity,
        average: 0,
        unit
      })
    }

    const metric = this.metrics.get(name)
    metric.count++
    metric.total += value
    metric.min = Math.min(metric.min, value)
    metric.max = Math.max(metric.max, value)
    metric.average = metric.total / metric.count

    EPGErrorHandler.debug(`Performance: ${name} = ${value.toFixed(2)}${unit}`)
  }

  getMetric(name) {
    return this.metrics.get(name) || null
  }

  getAllMetrics() {
    const result = {}
    for (const [name, metric] of this.metrics) {
      result[name] = { ...metric }
    }
    return result
  }

  getTopSlowOperations(limit = 10) {
    const operations = Array.from(this.metrics.entries())
      .map(([name, metric]) => ({ name, ...metric }))
      .sort((a, b) => b.average - a.average)
      .slice(0, limit)

    return operations
  }

  clearMetrics() {
    this.metrics.clear()
    this.startTimes.clear()
  }

  async measureAsync(name, asyncFn) {
    if (!this.isEnabled) {
      return await asyncFn()
    }

    this.startTimer(name)
    try {
      const result = await asyncFn()
      this.endTimer(name)
      return result
    } catch (error) {
      this.endTimer(name)
      throw error
    }
  }

  measure(name, fn) {
    if (!this.isEnabled) {
      return fn()
    }

    this.startTimer(name)
    try {
      const result = fn()
      this.endTimer(name)
      return result
    } catch (error) {
      this.endTimer(name)
      throw error
    }
  }

  measureMemoryUsage(name) {
    if (!this.isEnabled || typeof process === 'undefined') return

    const memUsage = process.memoryUsage()
    this.recordMetric(`${name}_heapUsed`, memUsage.heapUsed / 1024 / 1024, 'MB')
    this.recordMetric(`${name}_heapTotal`, memUsage.heapTotal / 1024 / 1024, 'MB')
    this.recordMetric(`${name}_rss`, memUsage.rss / 1024 / 1024, 'MB')
    this.recordMetric(`${name}_external`, memUsage.external / 1024 / 1024, 'MB')
  }

  generateReport() {
    const metrics = this.getAllMetrics()
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalOperations: Object.keys(metrics).length,
        totalMeasurements: Object.values(metrics).reduce((sum, m) => sum + m.count, 0)
      },
      performance: {},
      memory: {},
      slowOperations: this.getTopSlowOperations(5)
    }

    // Categorize metrics
    for (const [name, metric] of Object.entries(metrics)) {
      if (name.includes('_heap') || name.includes('_rss') || name.includes('_external')) {
        report.memory[name] = metric
      } else {
        report.performance[name] = metric
      }
    }

    return report
  }

  logReport() {
    const report = this.generateReport()
    
    EPGErrorHandler.info('Performance Report:')
    EPGErrorHandler.info(`Total Operations: ${report.summary.totalOperations}`)
    EPGErrorHandler.info(`Total Measurements: ${report.summary.totalMeasurements}`)
    
    if (report.slowOperations.length > 0) {
      EPGErrorHandler.info('Slowest Operations:')
      report.slowOperations.forEach((op, index) => {
        EPGErrorHandler.info(`  ${index + 1}. ${op.name}: ${op.average.toFixed(2)}${op.unit} (${op.count} calls)`)
      })
    }

    return report
  }

  // Benchmark a function multiple times
  async benchmark(name, fn, iterations = 100) {
    if (!this.isEnabled) {
      return await fn()
    }

    const results = []
    let totalTime = 0

    EPGErrorHandler.info(`Starting benchmark: ${name} (${iterations} iterations)`)

    for (let i = 0; i < iterations; i++) {
      const startTime = process.hrtime.bigint()
      
      try {
        if (typeof fn === 'function') {
          if (fn.constructor.name === 'AsyncFunction') {
            await fn()
          } else {
            fn()
          }
        }
      } catch (error) {
        EPGErrorHandler.warn(`Benchmark iteration ${i + 1} failed:`, error.message)
        continue
      }

      const endTime = process.hrtime.bigint()
      const duration = Number((endTime - startTime) / BigInt(1000000)) // Convert to ms safely
      
      results.push(duration)
      totalTime += duration
    }

    if (results.length === 0) {
      EPGErrorHandler.error(`Benchmark ${name} failed - no successful iterations`)
      return null
    }

    results.sort((a, b) => a - b)
    
    const benchmarkResult = {
      name,
      iterations: results.length,
      totalTime: totalTime.toFixed(2),
      average: (totalTime / results.length).toFixed(2),
      median: results[Math.floor(results.length / 2)].toFixed(2),
      min: results[0].toFixed(2),
      max: results[results.length - 1].toFixed(2),
      p95: results[Math.floor(results.length * 0.95)].toFixed(2),
      p99: results[Math.floor(results.length * 0.99)].toFixed(2)
    }

    EPGErrorHandler.info(`Benchmark complete: ${name}`)
    EPGErrorHandler.info(`  Average: ${benchmarkResult.average}ms`)
    EPGErrorHandler.info(`  Median: ${benchmarkResult.median}ms`)
    EPGErrorHandler.info(`  95th percentile: ${benchmarkResult.p95}ms`)

    return benchmarkResult
  }
}
