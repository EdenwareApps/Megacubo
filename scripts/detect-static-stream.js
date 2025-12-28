#!/usr/bin/env node

/**
 * Script to detect static video streams (expired transmissions with static messages)
 * 
 * This script analyzes a video stream to determine if it contains actual video content
 * or just a static message/image (like "list expired" messages).
 * 
 * Usage:
 *   node scripts/detect-static-stream.js <url>
 * 
 * Exit codes:
 *   0 - Stream has valid video content (movement detected)
 *   1 - Stream appears to be static (no movement detected)
 *   2 - Error occurred during analysis
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Download from '../www/nodejs/modules/download/download.js';
import StreamInfo from '../www/nodejs/modules/streamer/utils/stream-info.js';
import paths from '../www/nodejs/modules/paths/paths.js';
import { isSyncByteValid, findSyncBytePosition, isPacketized, absolutize } from '../www/nodejs/modules/utils/utils.js';
import { tmpdir } from 'os';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
    // Minimum data size to analyze (bytes)
    MIN_SAMPLE_SIZE: 50000,
    // Maximum sample size to download (bytes) - enough for MPEG-TS analysis
    MAX_SAMPLE_SIZE: 2000000, // ~2MB - enough for ~10k packets
    // Timeout for download (seconds)
    DOWNLOAD_TIMEOUT: 30,
    // MPEG-TS packet size
    TS_PACKET_SIZE: 188,
    // Number of packets to analyze for PCR
    TS_PACKETS_TO_ANALYZE: 200,
    // Minimum PCR difference to consider stream active (90kHz ticks)
    TS_MIN_PCR_DIFF: 2700000, // ~30 seconds at 90kHz
    // Number of payload samples to compare per PID
    TS_PAYLOAD_SAMPLES: 3,
    // Minimum payload hash difference rate (0-1) to consider as active stream
    TS_MIN_PAYLOAD_VARIATION: 0.3,
    // Maximum payload hash similarity to consider as static (with marquee)
    TS_MAX_PAYLOAD_SIMILARITY: 0.7, // If 70%+ of hashes are similar, likely static content
    // Minimum unique payload hashes per PID to consider as active
    TS_MIN_UNIQUE_HASHES: 10, // Need at least 10 unique hashes to be considered active
    // Number of segments to analyze for content variation
    TS_SEGMENTS_TO_ANALYZE: 3, // Analyze multiple segments to detect real content variation
    // Minimum unique hashes across all segments to consider as active
    TS_MIN_TOTAL_UNIQUE_HASHES: 50 // Need significant variation across segments
};

class StaticStreamDetector {
    constructor() {
        this.streamInfo = new StreamInfo();
        this.tempDir = paths.temp || tmpdir();
    }

    /**
     * Resolve M3U8 playlist to segment URL
     */
    async resolveM3U8(url) {
        console.log(`[INFO] Resolving M3U8 playlist: ${url}`);
        
        const download = new Download({
            url,
            timeout: {
                connect: 15,
                response: 10
            },
            maxContentLength: 10000, // M3U8 files are small
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const playlistContent = await new Promise((resolve, reject) => {
            const chunks = [];
            let finished = false;

            const finish = () => {
                if (finished) return;
                finished = true;
                const buffer = Buffer.concat(chunks);
                resolve(buffer.toString('utf8'));
            };

            download.on('data', (chunk) => chunks.push(chunk));
            download.once('end', finish);
            download.on('error', (err) => {
                if (!finished) {
                    finished = true;
                    reject(err);
                }
            });

            download.start();
        });

        console.log(`[INFO] Playlist content (first 500 chars): ${playlistContent.substring(0, 500)}`);

        // Parse M3U8 to find segment URLs
        const lines = playlistContent.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
        
        if (lines.length === 0) {
            throw new Error('No segments found in M3U8 playlist');
        }

        // Get a segment URL (prefer middle segment to avoid expired ones)
        const segmentIndex = Math.floor(lines.length / 2);
        let segmentUrl = lines[segmentIndex];
        
        // Make absolute URL using absolutize utility
        if (segmentUrl) {
            segmentUrl = absolutize(segmentUrl, url);
        }

        console.log(`[INFO] Selected segment ${segmentIndex + 1}/${lines.length}: ${segmentUrl}`);
        return segmentUrl;
    }

    /**
     * Download a sample of the stream
     */
    async downloadSample(url) {
        console.log(`[INFO] Downloading sample from: ${url}`);
        
        // Check if it's an M3U8 playlist
        if (url.includes('.m3u8') || url.endsWith('/index.m3u8')) {
            try {
                url = await this.resolveM3U8(url);
            } catch (error) {
                console.warn(`[WARN] Failed to resolve M3U8, trying direct download: ${error.message}`);
            }
        }
        
        const download = new Download({
            url,
            timeout: {
                connect: 15,
                response: CONFIG.DOWNLOAD_TIMEOUT
            },
            maxContentLength: CONFIG.MAX_SAMPLE_SIZE,
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        return new Promise((resolve, reject) => {
            const chunks = [];
            let totalSize = 0;
            let finished = false;

            const finish = () => {
                if (finished) return;
                finished = true;
                
                const buffer = Buffer.concat(chunks);
                console.log(`[INFO] Downloaded ${buffer.length} bytes`);
                
                // For M3U8 files, we need to resolve them first, so lower threshold
                const minSize = url.includes('.m3u8') ? 1000 : CONFIG.MIN_SAMPLE_SIZE;
                
                if (buffer.length < minSize) {
                    reject(new Error(`Sample too small: ${buffer.length} bytes (minimum: ${minSize})`));
                    return;
                }
                
                resolve(buffer);
            };

            download.on('data', (chunk) => {
                chunks.push(chunk);
                totalSize += chunk.length;
                
                if (totalSize >= CONFIG.MAX_SAMPLE_SIZE) {
                    download.destroy();
                    finish();
                }
            });

            download.once('response', (statusCode, headers) => {
                console.log(`[INFO] Response: ${statusCode}`);
                if (statusCode < 200 || statusCode >= 400) {
                    reject(new Error(`HTTP ${statusCode}`));
                }
            });

            download.once('end', finish);
            download.on('error', (err) => {
                if (!finished) {
                    finished = true;
                    reject(err);
                }
            });

            download.start();
        });
    }


    /**
     * Quick check if buffer is likely MPEG-TS (lightweight, no full analysis)
     */
    isLikelyMPEGTS(buffer) {
        if (!Buffer.isBuffer(buffer) || buffer.length < CONFIG.TS_PACKET_SIZE * 3) {
            return false;
        }
        
        // Check for sync bytes at expected positions (every 188 bytes)
        let validPackets = 0;
        const maxCheck = Math.min(10, Math.floor(buffer.length / CONFIG.TS_PACKET_SIZE));
        
        for (let i = 0; i < maxCheck; i++) {
            const pos = i * CONFIG.TS_PACKET_SIZE;
            if (pos + CONFIG.TS_PACKET_SIZE > buffer.length) break;
            
            if (buffer[pos] === 0x47) { // Sync byte
                // Quick PID validation
                const pid = ((buffer[pos + 1] & 0x1F) << 8) | buffer[pos + 2];
                if (pid <= 0x1FFF) {
                    validPackets++;
                }
            }
        }
        
        // If at least 70% of checked packets are valid, consider it MPEG-TS
        return validPackets >= Math.ceil(maxCheck * 0.7);
    }

    /**
     * Extract PCR (Program Clock Reference) from MPEG-TS packet
     */
    extractPCR(buffer, position) {
        if (position + 12 >= buffer.length) return null;
        
        const header = buffer.readUInt32BE(position);
        const adaptationFieldControl = (header & 0x30) >>> 4;
        
        // Check if adaptation field exists
        if ((adaptationFieldControl & 0x2) === 0) return null;
        
        if (position + 5 >= buffer.length) return null;
        
        const adaptationFieldLength = buffer.readUInt8(position + 4);
        if (adaptationFieldLength === 0) return null;
        
        if (position + 6 >= buffer.length) return null;
        
        const flags = buffer.readUInt8(position + 5);
        
        // Check if PCR flag is set (bit 4 = PCR, bit 3 = OPCR)
        if ((flags & 0x10) === 0 && (flags & 0x08) === 0) return null;
        
        if (position + 12 >= buffer.length) return null;
        
        // PCR is 6 bytes: 33 bits base + 6 bits reserved + 9 bits extension
        const pcrBase = buffer.readUInt32BE(position + 6);
        const pcrExtension = buffer.readUInt16BE(position + 10);
        
        // PCR base (33 bits): first 32 bits are in pcrBase, MSB is in bit 15 of pcrExtension
        // PCR = (pcrBase * 2) + MSB from extension, then * 300 + (extension & 0x1FF)
        const pcrBaseAdjusted = (pcrBase << 1) | ((pcrExtension & 0x8000) ? 1 : 0);
        const pcrExtensionValue = pcrExtension & 0x1FF;
        
        return pcrBaseAdjusted * 300 + pcrExtensionValue;
    }

    /**
     * Extract PID from MPEG-TS packet
     */
    extractPID(buffer, position) {
        if (position + 2 >= buffer.length) return null;
        const pid = ((buffer[position + 1] & 0x1F) << 8) | buffer[position + 2];
        return pid;
    }

    /**
     * Extract Continuity Counter from MPEG-TS packet
     */
    extractContinuityCounter(buffer, position) {
        if (position + 3 >= buffer.length) return null;
        return buffer[position + 3] & 0x0F;
    }

    /**
     * Get payload start position in MPEG-TS packet
     */
    getPayloadStart(buffer, position) {
        if (position + 4 >= buffer.length) return null;
        
        const header = buffer.readUInt32BE(position);
        const adaptationFieldControl = (header & 0x30) >>> 4;
        const payloadUnitStart = (header & 0x400000) !== 0;
        
        let payloadStart = 4; // Header is 4 bytes
        
        // Check if adaptation field exists
        if ((adaptationFieldControl & 0x2) !== 0) {
            if (position + 5 >= buffer.length) return null;
            const adaptationFieldLength = buffer.readUInt8(position + 4);
            payloadStart = 5 + adaptationFieldLength;
        }
        
        return position + payloadStart;
    }

    /**
     * Calculate hash of packet payload
     */
    hashPayload(buffer, position) {
        const payloadStart = this.getPayloadStart(buffer, position);
        if (!payloadStart || payloadStart >= position + CONFIG.TS_PACKET_SIZE) return null;
        
        const payloadLength = (position + CONFIG.TS_PACKET_SIZE) - payloadStart;
        if (payloadLength <= 0) return null;
        
        const payload = buffer.slice(payloadStart, position + CONFIG.TS_PACKET_SIZE);
        // Use first 64 bytes for quick hash comparison
        const sample = payload.slice(0, Math.min(64, payload.length));
        return createHash('md5').update(sample).digest('hex');
    }

    /**
     * Analyze MPEG-TS stream using lightweight packet analysis
     */
    analyzeMPEGTS(buffer) {
        console.log(`[INFO] Analyzing MPEG-TS stream (${buffer.length} bytes)`);
        
        // Quick check: try to find sync bytes
        const firstSyncByte = findSyncBytePosition(buffer, 0);
        if (firstSyncByte === -1) {
            console.warn(`[WARN] No sync byte found in buffer`);
            return { isStatic: null, reason: 'No sync byte found' };
        }

        let position = firstSyncByte;

        const pcrValues = [];
        const pidPCRMap = new Map(); // Map PID -> array of PCRs
        const pidContinuityMap = new Map(); // Map PID -> array of continuity counters
        const pidPayloadHashes = new Map(); // Map PID -> array of payload hashes
        const uniquePIDs = new Set();
        
        let packetsAnalyzed = 0;
        const maxPackets = CONFIG.TS_PACKETS_TO_ANALYZE;
        
        // Sample packets from different positions in the buffer
        const samplePositions = [
            Math.floor(buffer.length * 0.1), // 10% into buffer
            Math.floor(buffer.length * 0.3), // 30% into buffer
            Math.floor(buffer.length * 0.5), // 50% into buffer
            Math.floor(buffer.length * 0.7), // 70% into buffer
            Math.floor(buffer.length * 0.9)  // 90% into buffer
        ];

        // Analyze packets from different positions
        console.log(`[INFO] Starting packet analysis from ${samplePositions.length} sample positions`);
        for (let posIdx = 0; posIdx < samplePositions.length; posIdx++) {
            const startPos = samplePositions[posIdx];
            position = findSyncBytePosition(buffer, startPos);
            if (position === -1) {
                console.log(`[INFO] No sync byte found at position ${startPos}, skipping`);
                continue;
            }

            console.log(`[INFO] Analyzing from position ${posIdx + 1}/${samplePositions.length} (buffer pos: ${position})`);
            const packetsPerPosition = Math.floor(maxPackets / samplePositions.length);
            let packetsFromThisPosition = 0;
            let consecutiveErrors = 0;
            const maxConsecutiveErrors = 10;
            let iterations = 0;
            const maxIterations = packetsPerPosition * 2; // Safety limit

            // Analyze a batch of packets from this position
            while (packetsFromThisPosition < packetsPerPosition && 
                   position + CONFIG.TS_PACKET_SIZE <= buffer.length &&
                   position < buffer.length &&
                   iterations < maxIterations) {
                iterations++;
                
                if (!isSyncByteValid(buffer, position, true)) {
                    consecutiveErrors++;
                    if (consecutiveErrors > maxConsecutiveErrors) {
                        console.log(`[INFO] Too many consecutive errors at position ${position}, skipping`);
                        break;
                    }
                    const newPos = findSyncBytePosition(buffer, position + 1);
                    if (newPos === -1 || newPos === position) {
                        position += 1; // Advance by 1 byte if no sync byte found
                        if (position >= buffer.length) break;
                        continue;
                    }
                    position = newPos;
                    continue;
                }

                consecutiveErrors = 0; // Reset error counter on valid packet

                const pid = this.extractPID(buffer, position);
                if (pid === null || pid > 0x1FFF) {
                    position += CONFIG.TS_PACKET_SIZE;
                    continue;
                }

                uniquePIDs.add(pid);

                // Extract PCR
                const pcr = this.extractPCR(buffer, position);
                if (pcr !== null) {
                    pcrValues.push(pcr);
                    if (!pidPCRMap.has(pid)) {
                        pidPCRMap.set(pid, []);
                    }
                    pidPCRMap.get(pid).push(pcr);
                }

                // Extract continuity counter
                const cc = this.extractContinuityCounter(buffer, position);
                if (cc !== null) {
                    if (!pidContinuityMap.has(pid)) {
                        pidContinuityMap.set(pid, []);
                    }
                    pidContinuityMap.get(pid).push(cc);
                }

                // Extract payload hash (only for some packets to avoid slowness)
                if (packetsFromThisPosition % 2 === 0) { // Sample every other packet
                    const payloadHash = this.hashPayload(buffer, position);
                    if (payloadHash !== null) {
                        if (!pidPayloadHashes.has(pid)) {
                            pidPayloadHashes.set(pid, []);
                        }
                        const hashes = pidPayloadHashes.get(pid);
                        // Only store if different from last hash
                        if (hashes.length === 0 || hashes[hashes.length - 1] !== payloadHash) {
                            hashes.push(payloadHash);
                        }
                    }
                }

                packetsAnalyzed++;
                packetsFromThisPosition++;
                position += CONFIG.TS_PACKET_SIZE;
                
                // Safety check to prevent infinite loops
                if (packetsAnalyzed >= maxPackets * 2) {
                    console.log(`[WARN] Reached maximum packet limit (${packetsAnalyzed}), stopping analysis`);
                    break;
                }
            }
            
            console.log(`[INFO] Completed position ${posIdx + 1}: analyzed ${packetsFromThisPosition} packets (total: ${packetsAnalyzed})`);
            
            if (packetsAnalyzed >= maxPackets) {
                console.log(`[INFO] Analyzed enough packets (${packetsAnalyzed}), stopping early`);
                break;
            }
        }

        console.log(`[INFO] Analyzed ${packetsAnalyzed} packets`);
        console.log(`[INFO] Found ${uniquePIDs.size} unique PIDs`);
        console.log(`[INFO] Found ${pcrValues.length} PCR values`);

        // Analysis 1: PCR progression
        let pcrProgression = false;
        if (pcrValues.length >= 2) {
            const sortedPCRs = [...pcrValues].sort((a, b) => a - b);
            const minPCR = sortedPCRs[0];
            const maxPCR = sortedPCRs[sortedPCRs.length - 1];
            const pcrDiff = maxPCR - minPCR;
            
            console.log(`[INFO] PCR range: ${minPCR} to ${maxPCR} (diff: ${pcrDiff})`);
            
            // Check if PCRs advance significantly
            pcrProgression = pcrDiff >= CONFIG.TS_MIN_PCR_DIFF;
            
            // Also check PCR progression per PID
            for (const [pid, pcrs] of pidPCRMap.entries()) {
                if (pcrs.length >= 2) {
                    const pidPCRDiff = Math.max(...pcrs) - Math.min(...pcrs);
                    if (pidPCRDiff >= CONFIG.TS_MIN_PCR_DIFF) {
                        pcrProgression = true;
                        console.log(`[INFO] PID ${pid} shows PCR progression: ${pidPCRDiff}`);
                        break;
                    }
                }
            }
        }

        // Analysis 2: Continuity Counter progression
        let continuityProgression = false;
        for (const [pid, counters] of pidContinuityMap.entries()) {
            if (counters.length >= 2) {
                // Check if counters increment (accounting for wrap-around at 15)
                let hasProgression = false;
                for (let i = 1; i < counters.length; i++) {
                    const diff = (counters[i] - counters[i - 1] + 16) % 16;
                    if (diff > 0 && diff < 16) {
                        hasProgression = true;
                        break;
                    }
                }
                if (hasProgression) {
                    continuityProgression = true;
                    console.log(`[INFO] PID ${pid} shows continuity counter progression`);
                    break;
                }
            }
        }

        // Analysis 3: Payload variation (more sophisticated)
        let payloadVariation = false;
        let payloadVariationRate = 0;
        let totalUniqueHashes = 0;
        let totalHashSamples = 0;
        
        for (const [pid, hashes] of pidPayloadHashes.entries()) {
            if (hashes.length >= 2) {
                // Count unique hashes
                const uniqueHashes = new Set(hashes);
                const variationRate = uniqueHashes.size / hashes.length;
                const uniqueCount = uniqueHashes.size;
                
                totalUniqueHashes += uniqueCount;
                totalHashSamples += hashes.length;
                
                console.log(`[INFO] PID ${pid}: ${uniqueCount} unique hashes from ${hashes.length} samples (${(variationRate * 100).toFixed(2)}% variation)`);
                
                // Consider as variation if:
                // - Variation rate is high AND
                // - Has enough unique hashes (indicating significant content changes)
                if (variationRate >= CONFIG.TS_MIN_PAYLOAD_VARIATION && uniqueCount >= CONFIG.TS_MIN_UNIQUE_HASHES) {
                    payloadVariation = true;
                    console.log(`[INFO] PID ${pid} shows significant payload variation (${uniqueCount} unique hashes)`);
                }
                
                payloadVariationRate = Math.max(payloadVariationRate, variationRate);
            }
        }
        
        const avgUniqueHashes = totalHashSamples > 0 ? totalUniqueHashes / totalHashSamples : 0;
        console.log(`[INFO] Average unique hashes per sample: ${avgUniqueHashes.toFixed(2)}`);

        // Determine if stream is static
        // Stream is static (or static with marquee) if:
        // - PCRs advance (but content is repetitive) OR
        // - Continuity counters progress (but content is repetitive) OR
        // - Payload has very few unique hashes (indicating repetitive/static content)
        // 
        // A static stream with marquee will have:
        // - PCR progression (time advances)
        // - Continuity counter progression (packets advance)
        // - But very few unique payload hashes (same content repeating with small variations)
        const hasLowContentVariation = totalUniqueHashes < CONFIG.TS_MIN_UNIQUE_HASHES * 2 || 
                                       avgUniqueHashes < 0.1;
        
        const isStatic = hasLowContentVariation || 
                        (!pcrProgression && !continuityProgression && !payloadVariation);

        console.log(`[INFO] PCR progression: ${pcrProgression}`);
        console.log(`[INFO] Continuity counter progression: ${continuityProgression}`);
        console.log(`[INFO] Payload variation: ${payloadVariation} (${(payloadVariationRate * 100).toFixed(2)}%)`);
        console.log(`[INFO] Total unique payload hashes: ${totalUniqueHashes}`);
        console.log(`[INFO] Low content variation: ${hasLowContentVariation}`);

        return {
            isStatic,
            pcrProgression,
            continuityProgression,
            payloadVariation,
            payloadVariationRate,
            totalUniqueHashes,
            avgUniqueHashes,
            hasLowContentVariation,
            uniquePIDs: uniquePIDs.size,
            packetsAnalyzed,
            pcrCount: pcrValues.length
        };
    }

    /**
     * Analyze stream buffer for variation (fallback method)
     */
    analyzeBufferVariation(buffer) {
        console.log(`[INFO] Analyzing buffer variation (${buffer.length} bytes)`);
        
        // Split buffer into chunks and analyze variation
        const chunkCount = 5;
        const chunkSize = Math.floor(buffer.length / chunkCount);
        const chunks = [];
        
        for (let i = 0; i < chunkCount; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, buffer.length);
            chunks.push(buffer.slice(start, end));
        }

        // Calculate entropy/variation for each chunk
        const entropies = chunks.map(chunk => {
            const byteCounts = new Array(256).fill(0);
            for (let i = 0; i < chunk.length; i++) {
                byteCounts[chunk[i]]++;
            }
            
            // Calculate Shannon entropy
            let entropy = 0;
            for (let count of byteCounts) {
                if (count > 0) {
                    const p = count / chunk.length;
                    entropy -= p * Math.log2(p);
                }
            }
            return entropy;
        });

        // Calculate variation between chunks
        const avgEntropy = entropies.reduce((a, b) => a + b, 0) / entropies.length;
        const entropyVariance = entropies.reduce((sum, e) => sum + Math.pow(e - avgEntropy, 2), 0) / entropies.length;
        const entropyStdDev = Math.sqrt(entropyVariance);
        const entropyCoefficient = avgEntropy > 0 ? entropyStdDev / avgEntropy : 0;

        console.log(`[INFO] Average entropy: ${avgEntropy.toFixed(4)}`);
        console.log(`[INFO] Entropy coefficient of variation: ${entropyCoefficient.toFixed(4)}`);

        // Low entropy variation suggests static content
        const isStatic = avgEntropy < 2.0 || entropyCoefficient < 0.1;

        return {
            isStatic,
            avgEntropy,
            entropyCoefficient,
            entropies
        };
    }

    /**
     * Analyze multiple segments to detect content variation
     */
    async analyzeMultipleSegments(m3u8Url) {
        console.log(`[INFO] Analyzing multiple segments for content variation...`);
        
        // Get playlist
        const playlistContent = await new Promise((resolve, reject) => {
            const download = new Download({
                url: m3u8Url,
                timeout: { connect: 15, response: 10 },
                maxContentLength: 10000,
                headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            
            const chunks = [];
            download.on('data', (chunk) => chunks.push(chunk));
            download.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            download.on('error', reject);
            download.start();
        });

        const lines = playlistContent.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
        const segmentsToAnalyze = Math.min(CONFIG.TS_SEGMENTS_TO_ANALYZE, lines.length);
        
        console.log(`[INFO] Will analyze ${segmentsToAnalyze} segments from playlist`);
        
        const allSegmentHashes = [];
        
        for (let i = 0; i < segmentsToAnalyze; i++) {
            const segmentIndex = Math.floor(i * (lines.length / segmentsToAnalyze));
            let segmentUrl = lines[segmentIndex];
            if (segmentUrl) {
                segmentUrl = absolutize(segmentUrl, m3u8Url);
                
                try {
                    console.log(`[INFO] Downloading segment ${i + 1}/${segmentsToAnalyze}...`);
                    const segmentBuffer = await this.downloadSample(segmentUrl);
                    
                    // Extract multiple representative samples from the segment
                    const samples = [];
                    const sampleCount = 5;
                    for (let s = 0; s < sampleCount; s++) {
                        const sampleStart = Math.floor(segmentBuffer.length * (s / sampleCount));
                        const sampleEnd = Math.floor(segmentBuffer.length * ((s + 1) / sampleCount));
                        const sample = segmentBuffer.slice(sampleStart, sampleEnd);
                        const sampleHash = createHash('md5').update(sample).digest('hex');
                        samples.push(sampleHash);
                    }
                    
                    // Calculate entropy of the segment
                    const byteCounts = new Array(256).fill(0);
                    for (let j = 0; j < segmentBuffer.length; j++) {
                        byteCounts[segmentBuffer[j]]++;
                    }
                    let entropy = 0;
                    for (let count of byteCounts) {
                        if (count > 0) {
                            const p = count / segmentBuffer.length;
                            entropy -= p * Math.log2(p);
                        }
                    }
                    
                    allSegmentHashes.push({
                        hashes: samples,
                        entropy: entropy,
                        size: segmentBuffer.length
                    });
                    console.log(`[INFO] Segment ${i + 1}: entropy=${entropy.toFixed(2)}, size=${segmentBuffer.length}`);
                } catch (err) {
                    console.warn(`[WARN] Failed to download segment ${i + 1}: ${err.message}`);
                }
            }
        }
        
        // Analyze similarity across segments
        // For static content with marquee, segments should have:
        // - Similar entropy (similar content structure)
        // - Similar sizes
        // - Similar hash patterns
        
        let entropyVariance = 0;
        let sizeVariance = 0;
        const entropies = allSegmentHashes.map(s => s.entropy);
        const sizes = allSegmentHashes.map(s => s.size);
        
        if (entropies.length >= 2) {
            const avgEntropy = entropies.reduce((a, b) => a + b, 0) / entropies.length;
            const entropyStdDev = Math.sqrt(entropies.reduce((sum, e) => sum + Math.pow(e - avgEntropy, 2), 0) / entropies.length);
            entropyVariance = avgEntropy > 0 ? entropyStdDev / avgEntropy : 0;
        }
        
        if (sizes.length >= 2) {
            const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
            const sizeStdDev = Math.sqrt(sizes.reduce((sum, s) => sum + Math.pow(s - avgSize, 2), 0) / sizes.length);
            sizeVariance = avgSize > 0 ? sizeStdDev / avgSize : 0;
        }
        
        // Count unique hash patterns (if all samples are similar, likely static)
        const allSampleHashes = allSegmentHashes.flatMap(s => s.hashes);
        const uniqueSampleHashes = new Set(allSampleHashes);
        const hashVariationRate = uniqueSampleHashes.size / allSampleHashes.length;
        
        console.log(`[INFO] Segment analysis:`);
        console.log(`  Entropy variance: ${entropyVariance.toFixed(4)}`);
        console.log(`  Size variance: ${sizeVariance.toFixed(4)}`);
        console.log(`  Hash variation: ${(hashVariationRate * 100).toFixed(2)}%`);
        
        // Static/marquee content will have:
        // - Low entropy variance (similar content structure)
        // - Low size variance (similar compression)
        // - High hash variation is OK (due to compression) but entropy should be similar
        const hasLowSegmentVariation = (entropyVariance < 0.05 && sizeVariance < 0.1) || 
                                       (entropyVariance < 0.1 && hashVariationRate > 0.8); // High hash variation but low entropy variance = likely static with marquee
        
        return {
            entropyVariance,
            sizeVariance,
            hashVariationRate,
            uniqueSegmentHashes: uniqueSampleHashes.size,
            totalSegments: allSegmentHashes.length,
            hasLowSegmentVariation
        };
    }

    /**
     * Main detection method
     */
    async detect(url) {
        try {
            const isM3U8 = url.includes('.m3u8') || url.endsWith('/index.m3u8');
            
            // For M3U8, analyze multiple segments first
            let segmentAnalysis = null;
            if (isM3U8) {
                try {
                    segmentAnalysis = await this.analyzeMultipleSegments(url);
                    console.log(`[INFO] Multi-segment analysis: hasLowSegmentVariation=${segmentAnalysis.hasLowSegmentVariation}`);
                } catch (err) {
                    console.warn(`[WARN] Multi-segment analysis failed: ${err.message}`);
                }
            }
            
            // Download sample for packet analysis
            const buffer = await this.downloadSample(url);
            
            // First, check if it's MPEG-TS format (quick check)
            console.log(`[INFO] Checking if buffer is MPEG-TS packetized (${buffer.length} bytes)...`);
            const quickTSCheck = this.isLikelyMPEGTS(buffer);
            console.log(`[INFO] Quick TS check result: ${quickTSCheck}`);
            
            if (quickTSCheck) {
                try {
                    console.log(`[INFO] Detected MPEG-TS format, using lightweight packet analysis`);
                    const tsAnalysis = this.analyzeMPEGTS(buffer);
                    
                    // Combine segment analysis with packet analysis
                    if (segmentAnalysis) {
                        // If segment analysis shows low variation, likely static/marquee
                        if (segmentAnalysis.hasLowSegmentVariation) {
                            tsAnalysis.isStatic = true;
                            tsAnalysis.reason = 'Low variation across multiple segments (likely static content with marquee)';
                        }
                        tsAnalysis.segmentAnalysis = segmentAnalysis;
                    }
                    
                    if (tsAnalysis.isStatic !== null) {
                        return {
                            isStatic: tsAnalysis.isStatic,
                            method: 'mpegts-packet-analysis',
                            reason: tsAnalysis.reason || (tsAnalysis.isStatic 
                                ? 'MPEG-TS analysis shows no progression (PCR, continuity counter, or payload)'
                                : 'MPEG-TS analysis shows active stream progression'),
                            details: tsAnalysis
                        };
                    }
                } catch (err) {
                    console.error(`[ERROR] Error during MPEG-TS analysis: ${err.message}`);
                    console.error(err.stack);
                }
            }

            // Fallback to buffer entropy analysis
            console.log(`[INFO] Using buffer entropy analysis (fallback)`);
            const bufferAnalysis = this.analyzeBufferVariation(buffer);
            
            return {
                isStatic: bufferAnalysis.isStatic,
                method: 'buffer-entropy-analysis',
                reason: bufferAnalysis.isStatic 
                    ? 'Low entropy variation detected in stream data'
                    : 'Significant variation detected in stream data',
                details: bufferAnalysis
            };

        } catch (error) {
            console.error(`[ERROR] Detection failed: ${error.message}`);
            throw error;
        }
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.error('Usage: node scripts/detect-static-stream.js <url>');
        process.exit(2);
    }

    const url = args[0];
    
    if (!url || !url.startsWith('http')) {
        console.error('[ERROR] Invalid URL provided');
        process.exit(2);
    }

    const detector = new StaticStreamDetector();
    
    try {
        console.log(`[INFO] Starting static stream detection for: ${url}`);
        console.log(`[INFO] Configuration:`, CONFIG);
        
        const result = await detector.detect(url);
        
        console.log(`\n[RESULT]`);
        console.log(`  Is Static: ${result.isStatic}`);
        console.log(`  Method: ${result.method}`);
        console.log(`  Reason: ${result.reason}`);
        
        if (result.details) {
            console.log(`  Details:`, JSON.stringify(result.details, null, 2));
        }
        
        // Exit with appropriate code
        process.exit(result.isStatic ? 1 : 0);
        
    } catch (error) {
        console.error(`[ERROR] ${error.message}`);
        if (error.stack) {
            console.error(`[ERROR] Stack: ${error.stack}`);
        }
        process.exit(2);
    }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('detect-static-stream.js')) {
    main();
}

export default StaticStreamDetector;

