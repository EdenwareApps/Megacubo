/**
 * Isolated test for FileWarmCache
 * Tests the file-based warmCache implementation to validate it works correctly
 */

import FileWarmCache from './file-warm-cache.js'
import fs from 'fs'
import path from 'path'
import { tmpdir } from 'os'

// Mock bitrate checker
class MockBitrateChecker {
    constructor() {
        this.samples = []
        this.accepting = true
    }
    
    acceptingSamples(size) {
        return this.accepting
    }
    
    addSample(file, size, isFile) {
        this.samples.push({ file, size, isFile })
    }
}

// Test utilities
function createTempDir() {
    const tempDir = path.join(tmpdir(), 'warmcache-test-' + Date.now())
    fs.mkdirSync(tempDir, { recursive: true })
    return tempDir
}

function cleanupTempDir(tempDir) {
    try {
        const files = fs.readdirSync(tempDir)
        for (const file of files) {
            fs.unlinkSync(path.join(tempDir, file))
        }
        fs.rmdirSync(tempDir)
    } catch (err) {
        // Ignore cleanup errors
    }
}

// Test functions
async function testBasicAppend() {
    console.log('🧪 Test 1: Basic append operation')
    const tempDir = createTempDir()
    const bitrateChecker = new MockBitrateChecker()
    
    try {
        const cache = new FileWarmCache({
            tempDir,
            warmCacheMaxSize: 1024 * 1024, // 1MB
            warmCacheMaxMaxSize: 2 * 1024 * 1024, // 2MB
            bitrateChecker
        })
        
        // Append some data
        const testData = Buffer.from('test data ' + 'x'.repeat(1000))
        cache.append(testData)
        
        // Wait a bit for file write
        await new Promise(resolve => setTimeout(resolve, 100))
        
        // Check length
        if (cache.length !== testData.length) {
            throw new Error(`Expected length ${testData.length}, got ${cache.length}`)
        }
        
        // Check file exists
        if (!fs.existsSync(cache.filePath)) {
            throw new Error('Cache file does not exist')
        }
        
        // Read and verify data
        const readData = cache.slice()
        if (!readData.equals(testData)) {
            throw new Error('Data mismatch')
        }
        
        cache.destroy()
        console.log('✅ Test 1 passed')
        return true
    } catch (err) {
        console.error('❌ Test 1 failed:', err.message)
        return false
    } finally {
        cleanupTempDir(tempDir)
    }
}

async function testMultipleAppends() {
    console.log('🧪 Test 2: Multiple append operations')
    const tempDir = createTempDir()
    const bitrateChecker = new MockBitrateChecker()
    
    try {
        const cache = new FileWarmCache({
            tempDir,
            warmCacheMaxSize: 10 * 1024 * 1024, // 10MB
            warmCacheMaxMaxSize: 20 * 1024 * 1024, // 20MB
            bitrateChecker
        })
        
        let totalSize = 0
        const chunks = []
        
        // Append multiple chunks
        for (let i = 0; i < 10; i++) {
            const chunk = Buffer.from(`chunk-${i}-` + 'x'.repeat(10000))
            cache.append(chunk)
            chunks.push(chunk)
            totalSize += chunk.length
            
            // Small delay between appends
            await new Promise(resolve => setTimeout(resolve, 50))
        }
        
        // Wait for all writes
        await new Promise(resolve => setTimeout(resolve, 200))
        
        // Verify total size
        if (cache.length !== totalSize) {
            throw new Error(`Expected total size ${totalSize}, got ${cache.length}`)
        }
        
        // Verify data integrity
        const readData = cache.slice()
        const expectedData = Buffer.concat(chunks)
        
        if (!readData.equals(expectedData)) {
            throw new Error('Data integrity check failed')
        }
        
        cache.destroy()
        console.log('✅ Test 2 passed')
        return true
    } catch (err) {
        console.error('❌ Test 2 failed:', err.message)
        return false
    } finally {
        cleanupTempDir(tempDir)
    }
}

async function testRotation() {
    console.log('🧪 Test 3: Rotation functionality')
    const tempDir = createTempDir()
    const bitrateChecker = new MockBitrateChecker()
    
    try {
        const maxSize = 100 * 1024 // 100KB
        const cache = new FileWarmCache({
            tempDir,
            warmCacheMaxSize: maxSize,
            warmCacheMaxMaxSize: maxSize * 2,
            bitrateChecker
        })
        
        cache.setCommitted(true)
        
        // Fill cache beyond max size
        const chunkSize = 10 * 1024 // 10KB chunks
        const chunks = 15 // Should trigger rotation
        
        for (let i = 0; i < chunks; i++) {
            const chunk = Buffer.from(`chunk-${i}-` + 'x'.repeat(chunkSize - 20))
            cache.append(chunk)
            await new Promise(resolve => setTimeout(resolve, 50))
        }
        
        // Wait for rotation
        await new Promise(resolve => setTimeout(resolve, 500))
        
        // Check that rotation occurred (file size should be reduced)
        const finalSize = cache.length
        if (finalSize > maxSize * 1.2) { // Allow some margin
            throw new Error(`Rotation failed: size ${finalSize} is still too large (max: ${maxSize})`)
        }
        
        cache.destroy()
        console.log('✅ Test 3 passed')
        return true
    } catch (err) {
        console.error('❌ Test 3 failed:', err.message)
        return false
    } finally {
        cleanupTempDir(tempDir)
    }
}

async function testAsyncRead() {
    console.log('🧪 Test 4: Async read (getSlice)')
    const tempDir = createTempDir()
    const bitrateChecker = new MockBitrateChecker()
    
    try {
        const cache = new FileWarmCache({
            tempDir,
            warmCacheMaxSize: 1024 * 1024,
            warmCacheMaxMaxSize: 2 * 1024 * 1024,
            bitrateChecker
        })
        
        // Append data
        const testData = Buffer.from('async test data ' + 'x'.repeat(5000))
        cache.append(testData)
        
        await new Promise(resolve => setTimeout(resolve, 100))
        
        // Test async read
        const readData = await cache.getSlice()
        
        if (!readData.equals(testData)) {
            throw new Error('Async read data mismatch')
        }
        
        cache.destroy()
        console.log('✅ Test 4 passed')
        return true
    } catch (err) {
        console.error('❌ Test 4 failed:', err.message)
        return false
    } finally {
        cleanupTempDir(tempDir)
    }
}

async function testDestroy() {
    console.log('🧪 Test 5: Destroy and cleanup')
    const tempDir = createTempDir()
    const bitrateChecker = new MockBitrateChecker()
    
    try {
        const cache = new FileWarmCache({
            tempDir,
            warmCacheMaxSize: 1024 * 1024,
            warmCacheMaxMaxSize: 2 * 1024 * 1024,
            bitrateChecker
        })
        
        // Append data
        cache.append(Buffer.from('test data'))
        await new Promise(resolve => setTimeout(resolve, 100))
        
        // Get file path from cache (it's stored internally)
        const filePath = cache.filePath || null
        
        // Destroy cache
        cache.destroy()
        
        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 100))
        
        // Check file is deleted
        if (fs.existsSync(filePath)) {
            throw new Error('Cache file was not deleted after destroy')
        }
        
        // Check length is zero
        if (cache.length !== 0) {
            throw new Error('Cache length should be 0 after destroy')
        }
        
        console.log('✅ Test 5 passed')
        return true
    } catch (err) {
        console.error('❌ Test 5 failed:', err.message)
        return false
    } finally {
        cleanupTempDir(tempDir)
    }
}

async function testMemoryUsage() {
    console.log('🧪 Test 6: Memory usage validation')
    const tempDir = createTempDir()
    const bitrateChecker = new MockBitrateChecker()
    
    try {
        const cache = new FileWarmCache({
            tempDir,
            warmCacheMaxSize: 10 * 1024 * 1024, // 10MB
            warmCacheMaxMaxSize: 20 * 1024 * 1024, // 20MB
            bitrateChecker
        })
        
        // Get initial memory usage
        const initialMem = process.memoryUsage().heapUsed
        
        // Append large amount of data (should be on disk, not in memory)
        const largeChunk = Buffer.alloc(5 * 1024 * 1024) // 5MB
        largeChunk.fill('x')
        cache.append(largeChunk)
        
        await new Promise(resolve => setTimeout(resolve, 200))
        
        // Check memory didn't increase significantly
        const finalMem = process.memoryUsage().heapUsed
        const memIncrease = finalMem - initialMem
        
        // Memory increase should be minimal (just metadata, not the 5MB buffer)
        if (memIncrease > 1024 * 1024) { // More than 1MB
            throw new Error(`Memory usage increased too much: ${Math.round(memIncrease / 1024)}KB (data should be on disk)`)
        }
        
        // Verify data is still accessible
        const readData = await cache.getSlice()
        if (readData.length !== largeChunk.length) {
            throw new Error('Data length mismatch')
        }
        
        cache.destroy()
        console.log(`✅ Test 6 passed (memory increase: ${Math.round(memIncrease / 1024)}KB)`)
        return true
    } catch (err) {
        console.error('❌ Test 6 failed:', err.message)
        return false
    } finally {
        cleanupTempDir(tempDir)
    }
}

// Run all tests
async function runTests() {
    console.log('🚀 Starting FileWarmCache isolated tests...\n')
    
    const tests = [
        testBasicAppend,
        testMultipleAppends,
        testRotation,
        testAsyncRead,
        testDestroy,
        testMemoryUsage
    ]
    
    const results = []
    
    for (const test of tests) {
        try {
            const result = await test()
            results.push(result)
            console.log('') // Empty line between tests
        } catch (err) {
            console.error('❌ Test crashed:', err)
            results.push(false)
        }
    }
    
    const passed = results.filter(r => r).length
    const total = results.length
    
    console.log('='.repeat(50))
    console.log(`📊 Test Results: ${passed}/${total} tests passed`)
    
    if (passed === total) {
        console.log('✅ All tests passed!')
        process.exit(0)
    } else {
        console.log('❌ Some tests failed')
        process.exit(1)
    }
}

// Run tests
runTests().catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
})

