"use strict";
/**
 * Copyright 2018 Novage LLC.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const Debug = require("debug");
const loader_interface_1 = require("./loader-interface");
const events_1 = require("events");
const http_media_manager_1 = require("./http-media-manager");
const p2p_media_manager_1 = require("./p2p-media-manager");
const media_peer_1 = require("./media-peer");
const segment_internal_1 = require("./segment-internal");
const speed_approximator_1 = require("./speed-approximator");
const getBrowserRTC = require("get-browser-rtc");
const Peer = require("simple-peer");
const defaultSettings = {
    cachedSegmentExpiration: 5 * 60 * 1000,
    cachedSegmentsCount: 30,
    useP2P: true,
    requiredSegmentsPriority: 1,
    simultaneousP2PDownloads: 3,
    httpDownloadProbability: 0.06,
    httpDownloadProbabilityInterval: 500,
    httpFailedSegmentTimeout: 10000,
    bufferedSegmentsCount: 20,
    webRtcMaxMessageSize: 64 * 1024 - 1,
    p2pSegmentDownloadTimeout: 60000,
    trackerAnnounce: ["wss://tracker.btorrent.xyz", "wss://tracker.openwebtorrent.com", "wss://tracker.fastcast.nz"],
    rtcConfig: Peer.config
};
class HybridLoader extends events_1.EventEmitter {
    constructor(settings = {}) {
        super();
        this.debug = Debug("p2pml:hybrid-loader");
        this.segments = new Map();
        this.segmentsQueue = [];
        this.httpDownloadProbabilityTimestamp = -999999;
        this.speedApproximator = new speed_approximator_1.SpeedApproximator();
        this.onPieceBytesDownloaded = (method, bytes, peerId) => {
            this.speedApproximator.addBytes(bytes, this.now());
            this.emit(loader_interface_1.Events.PieceBytesDownloaded, method, bytes, peerId);
        };
        this.onPieceBytesUploaded = (method, bytes, peerId) => {
            this.speedApproximator.addBytes(bytes, this.now());
            this.emit(loader_interface_1.Events.PieceBytesUploaded, method, bytes, peerId);
        };
        this.onSegmentLoaded = (segment, data, peerId) => {
            this.debug("segment loaded", segment.id, segment.url);
            const segmentInternal = new segment_internal_1.SegmentInternal(segment.id, segment.url, segment.range, segment.priority, data, this.speedApproximator.getSpeed(this.now()));
            this.segments.set(segment.id, segmentInternal);
            this.emitSegmentLoaded(segmentInternal, peerId);
            this.processSegmentsQueue();
            this.p2pManager.sendSegmentsMapToAll(this.createSegmentsMap());
        };
        this.onSegmentError = (segment, details, peerId) => {
            this.emit(loader_interface_1.Events.SegmentError, segment, details, peerId);
            this.processSegmentsQueue();
        };
        this.onPeerConnect = (peer) => {
            this.p2pManager.sendSegmentsMap(peer.id, this.createSegmentsMap());
            this.emit(loader_interface_1.Events.PeerConnect, peer);
        };
        this.onPeerClose = (peerId) => {
            this.emit(loader_interface_1.Events.PeerClose, peerId);
        };
        this.settings = Object.assign(defaultSettings, settings);
        this.debug("loader settings", this.settings);
        this.httpManager = this.createHttpManager();
        this.httpManager.on("segment-loaded", this.onSegmentLoaded);
        this.httpManager.on("segment-error", this.onSegmentError);
        this.httpManager.on("bytes-downloaded", (bytes) => this.onPieceBytesDownloaded("http", bytes));
        this.p2pManager = this.createP2PManager();
        this.p2pManager.on("segment-loaded", this.onSegmentLoaded);
        this.p2pManager.on("segment-error", this.onSegmentError);
        this.p2pManager.on("peer-data-updated", () => this.processSegmentsQueue());
        this.p2pManager.on("bytes-downloaded", (bytes, peerId) => this.onPieceBytesDownloaded("p2p", bytes, peerId));
        this.p2pManager.on("bytes-uploaded", (bytes, peerId) => this.onPieceBytesUploaded("p2p", bytes, peerId));
        this.p2pManager.on("peer-connected", this.onPeerConnect);
        this.p2pManager.on("peer-closed", this.onPeerClose);
    }
    static isSupported() {
        const browserRtc = getBrowserRTC();
        return (browserRtc && (browserRtc.RTCPeerConnection.prototype.createDataChannel !== undefined));
    }
    createHttpManager() {
        return new http_media_manager_1.HttpMediaManager(this.settings);
    }
    createP2PManager() {
        return new p2p_media_manager_1.P2PMediaManager(this.segments, this.settings);
    }
    load(segments, swarmId) {
        this.p2pManager.setSwarmId(swarmId);
        this.debug("load segments", segments, this.segmentsQueue);
        let updateSegmentsMap = false;
        // stop all http requests and p2p downloads for segments that are not in the new load
        for (const segment of this.segmentsQueue) {
            if (!segments.find(f => f.url == segment.url)) {
                this.debug("remove segment", segment.url);
                if (this.httpManager.isDownloading(segment)) {
                    updateSegmentsMap = true;
                    this.httpManager.abort(segment);
                }
                else {
                    this.p2pManager.abort(segment);
                }
                this.emit(loader_interface_1.Events.SegmentAbort, segment);
            }
        }
        for (const segment of segments) {
            if (!this.segmentsQueue.find(f => f.url == segment.url)) {
                this.debug("add segment", segment.url);
            }
        }
        // renew segment queue
        this.segmentsQueue = segments;
        // run main processing algorithm
        updateSegmentsMap = this.processSegmentsQueue() || updateSegmentsMap;
        // collect garbage
        updateSegmentsMap = this.collectGarbage() || updateSegmentsMap;
        if (updateSegmentsMap) {
            this.p2pManager.sendSegmentsMapToAll(this.createSegmentsMap());
        }
    }
    getSegment(id) {
        const segment = this.segments.get(id);
        return segment
            ? segment.data
                ? new loader_interface_1.Segment(segment.id, segment.url, segment.range, segment.priority, segment.data, segment.downloadSpeed)
                : undefined
            : undefined;
    }
    getSettings() {
        return this.settings;
    }
    getDetails() {
        return {
            peerId: this.p2pManager.getPeerId()
        };
    }
    destroy() {
        this.segmentsQueue = [];
        this.httpManager.destroy();
        this.p2pManager.destroy();
        this.segments.clear();
    }
    processSegmentsQueue() {
        const startingPriority = this.segmentsQueue.length > 0 ? this.segmentsQueue[0].priority : 0;
        this.debug("processSegmentsQueue - starting priority: " + startingPriority);
        let pendingCount = 0;
        for (const segment of this.segmentsQueue) {
            if (!this.segments.has(segment.id) && !this.httpManager.isDownloading(segment) && !this.p2pManager.isDownloading(segment)) {
                pendingCount++;
            }
        }
        if (pendingCount == 0) {
            return false;
        }
        let downloadedSegmentsCount = this.segmentsQueue.length - pendingCount;
        let updateSegmentsMap = false;
        for (let index = 0; index < this.segmentsQueue.length; index++) {
            const segment = this.segmentsQueue[index];
            const segmentPriority = index + startingPriority;
            if (!this.segments.has(segment.id)) {
                if (segmentPriority <= this.settings.requiredSegmentsPriority && !this.httpManager.isFailed(segment)) {
                    if (segmentPriority == 0 && !this.httpManager.isDownloading(segment) && this.httpManager.getActiveDownloadsCount() > 0) {
                        for (const s of this.segmentsQueue) {
                            this.httpManager.abort(s);
                            updateSegmentsMap = true;
                        }
                    }
                    if (this.httpManager.getActiveDownloadsCount() == 0) {
                        this.p2pManager.abort(segment);
                        this.httpManager.download(segment);
                        this.debug("HTTP download (priority)", segment.priority, segment.url);
                        updateSegmentsMap = true;
                    }
                }
                else if (!this.httpManager.isDownloading(segment) && this.p2pManager.getActiveDownloadsCount() < this.settings.simultaneousP2PDownloads && downloadedSegmentsCount < this.settings.bufferedSegmentsCount) {
                    if (this.p2pManager.download(segment)) {
                        this.debug("P2P download", segment.priority, segment.url);
                    }
                }
            }
            if (this.httpManager.getActiveDownloadsCount() == 1 && this.p2pManager.getActiveDownloadsCount() == this.settings.simultaneousP2PDownloads) {
                return updateSegmentsMap;
            }
        }
        if (this.httpManager.getActiveDownloadsCount() > 0) {
            return updateSegmentsMap;
        }
        const now = this.now();
        if (now - this.httpDownloadProbabilityTimestamp < this.settings.httpDownloadProbabilityInterval) {
            return updateSegmentsMap;
        }
        else {
            this.httpDownloadProbabilityTimestamp = now;
        }
        let pendingQueue = this.segmentsQueue.filter(segment => !this.segments.has(segment.id) &&
            !this.p2pManager.isDownloading(segment));
        downloadedSegmentsCount = this.segmentsQueue.length - pendingQueue.length;
        if (pendingQueue.length == 0 || downloadedSegmentsCount >= this.settings.bufferedSegmentsCount) {
            return updateSegmentsMap;
        }
        const segmentsMap = this.p2pManager.getOvrallSegmentsMap();
        pendingQueue = pendingQueue.filter(segment => !segmentsMap.get(segment.id));
        for (const segment of pendingQueue) {
            if (Math.random() <= this.settings.httpDownloadProbability && !this.httpManager.isFailed(segment)) {
                this.debug("HTTP download (random)", segment.priority, segment.url);
                this.httpManager.download(segment);
                updateSegmentsMap = true;
                break;
            }
        }
        return updateSegmentsMap;
    }
    emitSegmentLoaded(segmentInternal, peerId) {
        segmentInternal.lastAccessed = this.now();
        const segment = new loader_interface_1.Segment(segmentInternal.id, segmentInternal.url, segmentInternal.range, segmentInternal.priority, segmentInternal.data, segmentInternal.downloadSpeed);
        this.emit(loader_interface_1.Events.SegmentLoaded, segment, peerId);
    }
    createSegmentsMap() {
        const segmentsMap = [];
        this.segments.forEach((value, key) => segmentsMap.push([key, media_peer_1.MediaPeerSegmentStatus.Loaded]));
        this.httpManager.getActiveDownloadsKeys().forEach(key => segmentsMap.push([key, media_peer_1.MediaPeerSegmentStatus.LoadingByHttp]));
        return segmentsMap;
    }
    collectGarbage() {
        const segmentsToDelete = [];
        const remainingSegments = [];
        // Delete old segments
        const now = this.now();
        for (const segment of this.segments.values()) {
            if (now - segment.lastAccessed > this.settings.cachedSegmentExpiration) {
                segmentsToDelete.push(segment.id);
            }
            else {
                remainingSegments.push(segment);
            }
        }
        // Delete segments over cached count
        let countOverhead = remainingSegments.length - this.settings.cachedSegmentsCount;
        if (countOverhead > 0) {
            remainingSegments.sort((a, b) => a.lastAccessed - b.lastAccessed);
            for (const segment of remainingSegments) {
                if (!this.segmentsQueue.find(queueSegment => queueSegment.id == segment.id)) {
                    segmentsToDelete.push(segment.id);
                    countOverhead--;
                    if (countOverhead == 0) {
                        break;
                    }
                }
            }
        }
        segmentsToDelete.forEach(id => this.segments.delete(id));
        return segmentsToDelete.length > 0;
    }
    now() {
        return performance.now();
    }
} // end of HybridLoader
exports.default = HybridLoader;
