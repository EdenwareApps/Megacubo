import { kbfmt, kbsfmt } from '../../utils/utils.js'
import { EventEmitter } from "events";
import fs from "fs";
import ffmpeg from "../../ffmpeg/ffmpeg.js";
import { isSyncByteValid, findSyncBytePosition } from '../../utils/utils.js';
import { createHash } from 'crypto';

const TS_PACKET_SIZE = 188;
const TS_MIN_PCR_DIFF = 2700000; // ~30 seconds at 90kHz
const TS_MIN_PAYLOAD_VARIATION = 0.3;
const TS_MIN_UNIQUE_HASHES = 10;

class StreamQualityAnalyzer extends EventEmitter {
    constructor(opts = {}) {
        super();
        
        // Bitrate analysis (existing functionality)
        this.bitrates = [];
        this.bitrate = 0;
        this.minSampleSize = 96 * 1024;
        this.queue = [];
        this.checking = false;
        this.checkingCount = 0;
        this.checkingFails = 0;
        this.checkingBuffers = {};
        this.codecData = null;
        this._dimensions = null;
        this.url = opts.url || null;
        this.type = opts.type || null;
        this.currentSpeed = -1; // Will be set by adapter
        
        // Static stream detection
        this.staticDetection = {
            enabled: opts.staticDetection?.enabled !== false,
            samples: [], // Buffer samples for analysis
            minSamples: 2, // Minimum samples before analysis
            minSampleSize: 50000,
            maxSampleSize: 2000000,
            packetsToAnalyze: 200,
            confidenceThreshold: 0.7,
            autoFail: opts.staticDetection?.autoFail || false,
            debug: opts.staticDetection?.debug || false,
            ...opts.staticDetection
        };
        this.isStatic = null;
        this.staticConfidence = 0;
        this.destroyed = false;
        
        // Unified options
        this.opts = Object.assign({
            debug: false,
            minCheckSize: 48 * 1024,
            maxCheckSize: 3 * (1024 * 1024),
            checkingAmount: 2,
            maxCheckingFails: 8
        }, opts);
        this.checkedPaths = {};
    }
    
    // ========== Bitrate Analysis (existing methods) ==========
    findTwoClosestValues(values) {
        let distances = [], closest = [], results = [];
        values.forEach((n, i) => {
            distances[i] = [];
            values.forEach((m, j) => {
                if (i == j) {
                    distances[i][j] = Number.MAX_SAFE_INTEGER;
                } else {
                    distances[i][j] = Math.abs(m - n);
                }
            });
            let minimal = Math.min.apply(null, distances[i]);
            closest[i] = distances[i].indexOf(minimal);
            distances[i] = minimal;
        });
        let minimal = Math.min.apply(null, distances);
        let a = distances.indexOf(minimal), b = closest[a];
        return [values[a], values[b]];
    }
    
    save(bitrate, force) {
        const prevBitrate = this.bitrate;
        if (force) {
            this.bitrates = [bitrate];
            this.bitrate = bitrate;
            this.checkingCount = this.opts.checkingAmount;
        } else {
            this.bitrates.push(bitrate);
            this.checkingCount++;
            if (this.bitrates.length >= 3) {
                this.bitrate = this.findTwoClosestValues(this.bitrates).reduce((a, b) => a + b, 0) / 2;
                this.bitrates = this.bitrates.slice(-3);
            } else {
                this.bitrate = this.bitrates.reduce((a, b) => a + b, 0) / this.bitrates.length;
            }
        }
        if (this.bitrate != prevBitrate) {
            this.emit('bitrate', this.bitrate, this.currentSpeed);
        }
    }
    
    // ========== Static Stream Detection (new methods) ==========
    
    /**
     * Quick check if buffer is likely MPEG-TS
     */
    isLikelyMPEGTS(buffer) {
        if (!Buffer.isBuffer(buffer) || buffer.length < TS_PACKET_SIZE * 3) {
            return false;
        }
        
        let validPackets = 0;
        const maxCheck = Math.min(10, Math.floor(buffer.length / TS_PACKET_SIZE));
        
        for (let i = 0; i < maxCheck; i++) {
            const pos = i * TS_PACKET_SIZE;
            if (pos + TS_PACKET_SIZE > buffer.length) break;
            
            if (buffer[pos] === 0x47) { // Sync byte
                const pid = ((buffer[pos + 1] & 0x1F) << 8) | buffer[pos + 2];
                if (pid <= 0x1FFF) {
                    validPackets++;
                }
            }
        }
        
        return validPackets >= Math.ceil(maxCheck * 0.7);
    }

    /**
     * Extract PCR (Program Clock Reference) from MPEG-TS packet
     */
    extractPCR(buffer, position) {
        if (position + 12 >= buffer.length) return null;
        
        const header = buffer.readUInt32BE(position);
        const adaptationFieldControl = (header & 0x30) >>> 4;
        
        if ((adaptationFieldControl & 0x2) === 0) return null;
        if (position + 5 >= buffer.length) return null;
        
        const adaptationFieldLength = buffer.readUInt8(position + 4);
        if (adaptationFieldLength === 0) return null;
        if (position + 6 >= buffer.length) return null;
        
        const flags = buffer.readUInt8(position + 5);
        if ((flags & 0x10) === 0 && (flags & 0x08) === 0) return null;
        if (position + 12 >= buffer.length) return null;
        
        const pcrBase = buffer.readUInt32BE(position + 6);
        const pcrExtension = buffer.readUInt16BE(position + 10);
        
        const pcrBaseAdjusted = (pcrBase << 1) | ((pcrExtension & 0x8000) ? 1 : 0);
        const pcrExtensionValue = pcrExtension & 0x1FF;
        
        return pcrBaseAdjusted * 300 + pcrExtensionValue;
    }

    extractPID(buffer, position) {
        if (position + 2 >= buffer.length) return null;
        return ((buffer[position + 1] & 0x1F) << 8) | buffer[position + 2];
    }

    extractContinuityCounter(buffer, position) {
        if (position + 3 >= buffer.length) return null;
        return buffer[position + 3] & 0x0F;
    }

    getPayloadStart(buffer, position) {
        if (position + 4 >= buffer.length) return null;
        
        const header = buffer.readUInt32BE(position);
        const adaptationFieldControl = (header & 0x30) >>> 4;
        
        let payloadStart = 4;
        
        if ((adaptationFieldControl & 0x2) !== 0) {
            if (position + 5 >= buffer.length) return null;
            const adaptationFieldLength = buffer.readUInt8(position + 4);
            payloadStart = 5 + adaptationFieldLength;
        }
        
        return position + payloadStart;
    }

    hashPayload(buffer, position) {
        const payloadStart = this.getPayloadStart(buffer, position);
        if (!payloadStart || payloadStart >= position + TS_PACKET_SIZE) return null;
        
        const payloadLength = (position + TS_PACKET_SIZE) - payloadStart;
        if (payloadLength <= 0) return null;
        
        const payload = buffer.slice(payloadStart, position + TS_PACKET_SIZE);
        const sample = payload.slice(0, Math.min(64, payload.length));
        return createHash('md5').update(sample).digest('hex');
    }

    /**
     * Analyze MPEG-TS stream using lightweight packet analysis
     */
    analyzeMPEGTSStatic(buffer) {
        if (this.staticDetection.debug) {
            console.log(`[StaticDetection] Analyzing MPEG-TS stream (${buffer.length} bytes)`);
        }
        
        const firstSyncByte = findSyncBytePosition(buffer, 0);
        if (firstSyncByte === -1) {
            return { isStatic: null, confidence: 0 };
        }

        let position = firstSyncByte;
        const pcrValues = [];
        const pidPCRMap = new Map();
        const pidContinuityMap = new Map();
        const pidPayloadHashes = new Map();
        const uniquePIDs = new Set();
        
        let packetsAnalyzed = 0;
        const maxPackets = this.staticDetection.packetsToAnalyze;
        
        const samplePositions = [
            Math.floor(buffer.length * 0.1),
            Math.floor(buffer.length * 0.3),
            Math.floor(buffer.length * 0.5),
            Math.floor(buffer.length * 0.7),
            Math.floor(buffer.length * 0.9)
        ];

        for (let posIdx = 0; posIdx < samplePositions.length; posIdx++) {
            const startPos = samplePositions[posIdx];
            position = findSyncBytePosition(buffer, startPos);
            if (position === -1) continue;

            const packetsPerPosition = Math.floor(maxPackets / samplePositions.length);
            let packetsFromThisPosition = 0;
            let consecutiveErrors = 0;
            const maxConsecutiveErrors = 10;
            let iterations = 0;
            const maxIterations = packetsPerPosition * 2;

            while (packetsFromThisPosition < packetsPerPosition && 
                   position + TS_PACKET_SIZE <= buffer.length &&
                   position < buffer.length &&
                   iterations < maxIterations) {
                iterations++;
                
                if (!isSyncByteValid(buffer, position, true)) {
                    consecutiveErrors++;
                    if (consecutiveErrors > maxConsecutiveErrors) break;
                    const newPos = findSyncBytePosition(buffer, position + 1);
                    if (newPos === -1 || newPos === position) {
                        position += 1;
                        if (position >= buffer.length) break;
                        continue;
                    }
                    position = newPos;
                    continue;
                }

                consecutiveErrors = 0;
                const pid = this.extractPID(buffer, position);
                if (pid === null || pid > 0x1FFF) {
                    position += TS_PACKET_SIZE;
                    continue;
                }

                uniquePIDs.add(pid);

                const pcr = this.extractPCR(buffer, position);
                if (pcr !== null) {
                    pcrValues.push(pcr);
                    if (!pidPCRMap.has(pid)) {
                        pidPCRMap.set(pid, []);
                    }
                    pidPCRMap.get(pid).push(pcr);
                }

                const cc = this.extractContinuityCounter(buffer, position);
                if (cc !== null) {
                    if (!pidContinuityMap.has(pid)) {
                        pidContinuityMap.set(pid, []);
                    }
                    pidContinuityMap.get(pid).push(cc);
                }

                if (packetsFromThisPosition % 2 === 0) {
                    const payloadHash = this.hashPayload(buffer, position);
                    if (payloadHash !== null) {
                        if (!pidPayloadHashes.has(pid)) {
                            pidPayloadHashes.set(pid, []);
                        }
                        const hashes = pidPayloadHashes.get(pid);
                        if (hashes.length === 0 || hashes[hashes.length - 1] !== payloadHash) {
                            hashes.push(payloadHash);
                        }
                    }
                }

                packetsAnalyzed++;
                packetsFromThisPosition++;
                position += TS_PACKET_SIZE;
                
                if (packetsAnalyzed >= maxPackets * 2) break;
            }
            
            if (packetsAnalyzed >= maxPackets) break;
        }

        // Analysis 1: PCR progression
        let pcrProgression = false;
        if (pcrValues.length >= 2) {
            const sortedPCRs = [...pcrValues].sort((a, b) => a - b);
            const pcrDiff = sortedPCRs[sortedPCRs.length - 1] - sortedPCRs[0];
            pcrProgression = pcrDiff >= TS_MIN_PCR_DIFF;
            
            if (!pcrProgression) {
                for (const [pid, pcrs] of pidPCRMap.entries()) {
                    if (pcrs.length >= 2) {
                        const pidPCRDiff = Math.max(...pcrs) - Math.min(...pcrs);
                        if (pidPCRDiff >= TS_MIN_PCR_DIFF) {
                            pcrProgression = true;
                            break;
                        }
                    }
                }
            }
        }

        // Analysis 2: Continuity Counter progression
        let continuityProgression = false;
        for (const [pid, counters] of pidContinuityMap.entries()) {
            if (counters.length >= 2) {
                for (let i = 1; i < counters.length; i++) {
                    const diff = (counters[i] - counters[i - 1] + 16) % 16;
                    if (diff > 0 && diff < 16) {
                        continuityProgression = true;
                        break;
                    }
                }
                if (continuityProgression) break;
            }
        }

        // Analysis 3: Payload variation
        let payloadVariation = false;
        let totalUniqueHashes = 0;
        let totalHashSamples = 0;
        
        for (const [pid, hashes] of pidPayloadHashes.entries()) {
            if (hashes.length >= 2) {
                const uniqueHashes = new Set(hashes);
                const variationRate = uniqueHashes.size / hashes.length;
                const uniqueCount = uniqueHashes.size;
                
                totalUniqueHashes += uniqueCount;
                totalHashSamples += hashes.length;
                
                if (variationRate >= TS_MIN_PAYLOAD_VARIATION && uniqueCount >= TS_MIN_UNIQUE_HASHES) {
                    payloadVariation = true;
                }
            }
        }
        
        const avgUniqueHashes = totalHashSamples > 0 ? totalUniqueHashes / totalHashSamples : 0;
        const hasLowContentVariation = totalUniqueHashes < TS_MIN_UNIQUE_HASHES * 2 || avgUniqueHashes < 0.1;
        
        const isStatic = hasLowContentVariation || 
                        (!pcrProgression && !continuityProgression && !payloadVariation);
        
        // Calculate confidence based on evidence
        let confidence = 0;
        if (isStatic) {
            if (hasLowContentVariation) confidence += 0.5;
            if (!pcrProgression && !continuityProgression) confidence += 0.3;
            if (!payloadVariation) confidence += 0.2;
        } else {
            if (pcrProgression && continuityProgression && payloadVariation) confidence = 0.9;
            else if (pcrProgression || continuityProgression) confidence = 0.5;
        }
        
        return { isStatic, confidence, packetsAnalyzed };
    }
    
    /**
     * Analyze buffer entropy (fallback)
     */
    analyzeBufferEntropy(buffer) {
        const chunkCount = 5;
        const chunkSize = Math.floor(buffer.length / chunkCount);
        const chunks = [];
        
        for (let i = 0; i < chunkCount; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, buffer.length);
            chunks.push(buffer.slice(start, end));
        }

        const entropies = chunks.map(chunk => this.calculateEntropy(chunk));
        const avgEntropy = entropies.reduce((a, b) => a + b, 0) / entropies.length;
        const entropyVariance = this.calculateVariance(entropies);
        
        const isStatic = avgEntropy < 2.0 || entropyVariance < 0.1;
        const confidence = isStatic ? 0.6 : 0.4;
        
        return { isStatic, confidence, entropyVariance };
    }
    
    /**
     * Analyze buffer for static content
     */
    analyzeStaticContent(buffer) {
        if (!this.staticDetection.enabled) {
            return null;
        }
        
        if (this.isLikelyMPEGTS(buffer)) {
            return this.analyzeMPEGTSStatic(buffer);
        } else {
            return this.analyzeBufferEntropy(buffer);
        }
    }
    
    /**
     * Add sample for static detection analysis
     */
    addStaticSample(buffer) {
        if (!this.staticDetection.enabled || this.destroyed) return;
        
        if (!Buffer.isBuffer(buffer)) return;
        
        if (buffer.length < this.staticDetection.minSampleSize ||
            buffer.length > this.staticDetection.maxSampleSize) {
            return;
        }
        
        // Create a copy to avoid issues if buffer is reused
        const bufferCopy = Buffer.from(buffer);
        this.staticDetection.samples.push(bufferCopy);
        
        // Keep only recent samples
        if (this.staticDetection.samples.length > this.staticDetection.minSamples + 1) {
            this.staticDetection.samples.shift();
        }
        
        // Analyze when we have enough samples
        if (this.staticDetection.samples.length >= this.staticDetection.minSamples) {
            this.checkStaticStream();
        }
    }
    
    /**
     * Check if stream is static based on collected samples
     */
    checkStaticStream() {
        const samples = this.staticDetection.samples;
        
        const results = [];
        for (const sample of samples) {
            const result = this.analyzeStaticContent(sample);
            if (result && result.isStatic !== null) {
                results.push(result);
            }
        }
        
        if (results.length >= 2) {
            const staticCount = results.filter(r => r.isStatic).length;
            const confidence = staticCount / results.length;
            
            // Check entropy variation across samples
            const entropies = samples.map(s => this.calculateEntropy(s));
            const entropyVariance = this.calculateVariance(entropies);
            
            const isStatic = confidence >= this.staticDetection.confidenceThreshold ||
                           entropyVariance < 0.1;
            
            const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
            const finalConfidence = Math.max(confidence, avgConfidence);
            
            if (this.isStatic !== isStatic || Math.abs(this.staticConfidence - finalConfidence) > 0.1) {
                this.isStatic = isStatic;
                this.staticConfidence = finalConfidence;
                
                this.emit('static-stream-detected', {
                    isStatic,
                    confidence: finalConfidence,
                    entropyVariance,
                    samplesAnalyzed: results.length
                });
                
                if (isStatic && this.staticDetection.autoFail && finalConfidence >= this.staticDetection.confidenceThreshold) {
                    this.emit('static-stream-fail', {
                        reason: 'static stream detected',
                        confidence: finalConfidence
                    });
                }
            }
        }
    }
    
    // ========== Utility methods ==========
    calculateEntropy(buffer) {
        const byteCounts = new Array(256).fill(0);
        for (let i = 0; i < buffer.length; i++) {
            byteCounts[buffer[i]]++;
        }
        let entropy = 0;
        for (let count of byteCounts) {
            if (count > 0) {
                const p = count / buffer.length;
                entropy -= p * Math.log2(p);
            }
        }
        return entropy;
    }
    
    calculateVariance(values) {
        if (values.length < 2) return 0;
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);
        return avg > 0 ? stdDev / avg : 0;
    }
    
    // ========== Unified Sample Collection ==========
    
    async addSample(file, size, deleteFileAfterChecking) {
        if (!this.acceptingSamples(size) || this.checkedPaths[file]) {
            if (deleteFileAfterChecking === true) {
                fs.unlink(file, err => {
                    if (err) console.error(file, err);
                });
            }
            return;
        }
        
        if (!size) {
            let err;
            const stat = await fs.promises.stat(file).catch(e => err = e);
            if (err || !stat || stat.size < this.minSampleSize) {
                if (deleteFileAfterChecking) {
                    await fs.promises.unlink(file).catch(err => console.error(err));
                }
                return false;
            }
            size = stat.size;
        }
        
        this.checkedPaths[file] = true;
        this.queue.push({ file, size, deleteFileAfterChecking });
        
        if (this.queue.length > this.opts.checkingAmount) {
            this.queue = this.queue.sortByProp('size', true);
            this.queue.slice(this.opts.checkingAmount).forEach(row => {
                if (row.deleteFileAfterChecking === true) {
                    fs.unlink(row.file, err => {
                        if (err) console.error(row.file, err);
                    });
                }
            });
            this.queue = this.queue.slice(0, this.opts.checkingAmount);
        }
        
        // Also read file for static detection (async, non-blocking)
        if (this.staticDetection.enabled && !this.isHTTP(file)) {
            // Use setImmediate to avoid blocking the bitrate check
            setImmediate(() => {
                if (this.destroyed) return;
                fs.readFile(file, (err, buffer) => {
                    if (!err && buffer && Buffer.isBuffer(buffer) && !this.destroyed) {
                        this.addStaticSample(buffer);
                    }
                });
            });
        }
        
        this.pump();
    }
    
    check(file, size, deleteFileAfterChecking) {
        if (!this.acceptingSamples(size)) {
            if (deleteFileAfterChecking === true) {
                fs.unlink(file, err => {
                    if (err) console.error(file, err);
                });
            }
            return;
        }
        
        this.checking = true;
        const isHTTP = this.isHTTP(file);
        
        if (this.destroyed || 
            (this.bitrates.length >= this.opts.checkingAmount && this.codecData) || 
            this.checkingFails >= this.opts.maxCheckingFails) {
            this.checking = false;
            this.queue = [];
            this.clearSamples();
        } else {
            console.log('getBitrate', file, this.url, isHTTP ? null : size, this.opts.minCheckSize);
            ffmpeg.bitrate(file, (err, bitrate, codecData, dimensions, nfo) => {
                if (deleteFileAfterChecking) {
                    fs.unlink(file, err => {
                        if (err) console.error(file, err);
                    });
                }
                if (!this.destroyed) {
                    console.log('gotBitrate', file, bitrate, codecData, dimensions, nfo);
                    if (codecData) {
                        this.codecData = codecData;
                        this.emit('codecData', codecData);
                    }
                    if (dimensions && !this._dimensions) {
                        this._dimensions = dimensions;
                        this.emit('dimensions', this._dimensions);
                    }
                    if (err) {
                        this.checkingFails++;
                        this.opts.minCheckSize += this.opts.minCheckSize * 0.5;
                        this.opts.maxCheckSize += this.opts.maxCheckSize * 0.5;
                        this.updateQueueSizeLimits();
                    } else {
                        if (this.opts.debug) {
                            console.log('gotBitrate*', err, bitrate, codecData, dimensions, this.url);
                        }
                        if (bitrate && bitrate > 0) {
                            this.save(bitrate);
                        }
                        if (this.opts.debug) {
                            console.log('[' + this.type + '] analyzing: ' + file, isHTTP ? '' : 'sample len: ' + kbfmt(size), 'bitrate: ' + kbsfmt(this.bitrate), this.bitrates, this.url, nfo);
                        }
                    }
                    this.checking = false;
                    this.pump();
                }
            });
        }
    }
    
    reset(bitrate) {
        this.clearSamples();
        this.bitrates = [];
        this.staticDetection.samples = [];
        this.isStatic = null;
        this.staticConfidence = 0;
        this.codecData = null;
        if (bitrate) {
            this.save(bitrate, true);
        }
    }
    
    clearSamples() {
        Object.keys(this.checkingBuffers).forEach(id => {
            let file = this.checkingBuffers[id].file;
            this.checkingBuffers[id].destroy();
            file && fs.unlink(file, () => {});
        });
        this.checkingBuffers = {};
        this.staticDetection.samples = [];
    }
    
    pump() {
        if (!this.checking) {
            if (this.queue.length && !this.destroyed) {
                const row = this.queue.shift();
                this.check(row.file, row.size, row.deleteFileAfterChecking);
            }
        }
    }
    
    updateQueueSizeLimits() {
        if (this.queue.length && !this.destroyed) {
            this.queue = this.queue.filter(row => {
                if (row.size && row.size < this.opts.minCheckSize) {
                    if (row.deleteFileAfterChecking) {
                        fs.unlink(row.file, err => {
                            if (err) console.error(row.file, err);
                        });
                    }
                    return false;
                }
                return true;
            });
        }
    }
    
    acceptingSamples(size) {
        if (size && size < this.opts.minCheckSize) {
            return false;
        }
        return this.checkingCount < this.opts.checkingAmount &&
            this.bitrates.length <= this.opts.checkingAmount &&
            this.checkingFails < this.opts.maxCheckingFails;
    }
    
    isHTTP(file) {
        return file.match(new RegExp('^(((rt[ms]p|https?)://)|//)'));
    }
}

export default StreamQualityAnalyzer;

// Backward compatibility: export as BitrateChecker alias for existing code
export { StreamQualityAnalyzer as BitrateChecker };

