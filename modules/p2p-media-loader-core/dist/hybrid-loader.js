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
    consumeOnly: false,
    requiredSegmentsPriority: 1,
    simultaneousHttpDownloads: 2,
    httpDownloadProbability: 0.06,
    httpDownloadProbabilityInterval: 500,
    httpDownloadProbabilitySkipIfNoPeers: false,
    httpFailedSegmentTimeout: 10000,
    httpDownloadMaxPriority: 20,
    httpDownloadInitialTimeout: 0,
    httpDownloadInitialTimeoutPerSegment: 4000,
    simultaneousP2PDownloads: 3,
    p2pDownloadMaxPriority: 20,
    p2pSegmentDownloadTimeout: 60000,
    webRtcMaxMessageSize: 64 * 1024 - 1,
    trackerAnnounce: ["wss://tracker.novage.com.ua", "wss://tracker.btorrent.xyz", "wss://tracker.openwebtorrent.com", "wss://tracker.fastcast.nz"],
    rtcConfig: Peer.config
};
class HybridLoader extends events_1.EventEmitter {
    constructor(settings = {}) {
        super();
        this.debug = Debug("p2pml:hybrid-loader");
        this.debugSegments = Debug("p2pml:hybrid-loader-segments");
        this.segments = new Map();
        this.segmentsQueue = [];
        this.speedApproximator = new speed_approximator_1.SpeedApproximator();
        this.httpDownloadInitialTimeoutTimestamp = -Infinity;
        this.initialDownloadedViaP2PSegmentsCount = 0;
        this.processInitialSegmentTimeout = () => {
            if (this.httpRandomDownloadInterval === undefined) {
                return; // Instance destroyed
            }
            if (this.processSegmentsQueue() && !this.settings.consumeOnly) {
                this.p2pManager.sendSegmentsMapToAll(this.createSegmentsMap());
            }
            if (this.httpDownloadInitialTimeoutTimestamp !== -Infinity) {
                // Set one more timeout for a next segment
                setTimeout(this.processInitialSegmentTimeout, this.settings.httpDownloadInitialTimeoutPerSegment);
            }
        };
        this.downloadRandomSegmentOverHttp = () => {
            if (this.httpRandomDownloadInterval === undefined) {
                return; // Instance destroyed
            }
            if (this.httpDownloadInitialTimeoutTimestamp !== -Infinity ||
                this.httpManager.getActiveDownloadsCount() >= this.settings.simultaneousHttpDownloads ||
                (this.settings.httpDownloadProbabilitySkipIfNoPeers && this.p2pManager.getPeers().size === 0) ||
                this.settings.consumeOnly) {
                return;
            }
            const segmentsMap = this.p2pManager.getOvrallSegmentsMap();
            const pendingQueue = this.segmentsQueue.filter(segment => !this.segments.has(segment.id) &&
                !this.p2pManager.isDownloading(segment) &&
                !this.httpManager.isDownloading(segment) &&
                !segmentsMap.has(segment.id) &&
                !this.httpManager.isFailed(segment) &&
                (segment.priority <= this.settings.httpDownloadMaxPriority));
            if (pendingQueue.length == 0) {
                return;
            }
            if (Math.random() > this.settings.httpDownloadProbability * pendingQueue.length) {
                return;
            }
            const segment = pendingQueue[Math.floor(Math.random() * pendingQueue.length)];
            this.debugSegments("HTTP download (random)", segment.priority, segment.url);
            this.httpManager.download(segment);
            this.p2pManager.sendSegmentsMapToAll(this.createSegmentsMap());
        };
        this.onPieceBytesDownloaded = (method, bytes, peerId) => {
            this.speedApproximator.addBytes(bytes, this.now());
            this.emit(loader_interface_1.Events.PieceBytesDownloaded, method, bytes, peerId);
        };
        this.onPieceBytesUploaded = (method, bytes, peerId) => {
            this.speedApproximator.addBytes(bytes, this.now());
            this.emit(loader_interface_1.Events.PieceBytesUploaded, method, bytes, peerId);
        };
        this.onSegmentLoaded = (segment, data, peerId) => {
            this.debugSegments("segment loaded", segment.id, segment.url);
            const segmentInternal = new segment_internal_1.SegmentInternal(segment.id, segment.url, segment.range, segment.priority, data, this.speedApproximator.getSpeed(this.now()));
            this.segments.set(segment.id, segmentInternal);
            this.emitSegmentLoaded(segmentInternal, peerId);
            if (this.httpDownloadInitialTimeoutTimestamp !== -Infinity) {
                // If initial HTTP download timeout enabled then
                // count sequential P2P segment downloads
                let loadedSegmentFound = false;
                for (const queueSegment of this.segmentsQueue) {
                    if (queueSegment.id === segment.id) {
                        loadedSegmentFound = true;
                    }
                    else if (!this.segments.has(queueSegment.id)) {
                        break;
                    }
                    if (loadedSegmentFound) {
                        this.initialDownloadedViaP2PSegmentsCount++;
                    }
                }
            }
            this.processSegmentsQueue();
            if (!this.settings.consumeOnly) {
                this.p2pManager.sendSegmentsMapToAll(this.createSegmentsMap());
            }
        };
        this.onSegmentError = (segment, details, peerId) => {
            this.debugSegments("segment error", segment.id, segment.url, peerId, details);
            this.emit(loader_interface_1.Events.SegmentError, segment, details, peerId);
            this.processSegmentsQueue();
        };
        this.onPeerConnect = (peer) => {
            if (!this.settings.consumeOnly) {
                this.p2pManager.sendSegmentsMap(peer.id, this.createSegmentsMap());
            }
            this.emit(loader_interface_1.Events.PeerConnect, peer);
        };
        this.onPeerClose = (peerId) => {
            this.emit(loader_interface_1.Events.PeerClose, peerId);
        };
        this.onTrackerUpdate = (data) => {
            if (this.httpDownloadInitialTimeoutTimestamp !== -Infinity &&
                data.incomplete !== undefined && data.incomplete <= 1) {
                this.debugSegments("cancel initial HTTP download timeout - no peers");
                this.httpDownloadInitialTimeoutTimestamp = -Infinity;
                if (this.processSegmentsQueue() && !this.settings.consumeOnly) {
                    this.p2pManager.sendSegmentsMapToAll(this.createSegmentsMap());
                }
            }
        };
        this.settings = Object.assign({}, defaultSettings, settings);
        if (settings.bufferedSegmentsCount) {
            if (settings.p2pDownloadMaxPriority === undefined) {
                this.settings.p2pDownloadMaxPriority = settings.bufferedSegmentsCount;
            }
            if (settings.httpDownloadMaxPriority === undefined) {
                this.settings.p2pDownloadMaxPriority = settings.bufferedSegmentsCount;
            }
            delete this.settings.bufferedSegmentsCount;
        }
        this.debug("loader settings", this.settings);
        this.httpManager = this.createHttpManager();
        this.httpManager.on("segment-loaded", this.onSegmentLoaded);
        this.httpManager.on("segment-error", this.onSegmentError);
        this.httpManager.on("bytes-downloaded", (bytes) => this.onPieceBytesDownloaded("http", bytes));
        this.p2pManager = this.createP2PManager();
        this.p2pManager.on("segment-loaded", this.onSegmentLoaded);
        this.p2pManager.on("segment-error", this.onSegmentError);
        this.p2pManager.on("peer-data-updated", () => {
            if (this.processSegmentsQueue() && !this.settings.consumeOnly) {
                this.p2pManager.sendSegmentsMapToAll(this.createSegmentsMap());
            }
        });
        this.p2pManager.on("bytes-downloaded", (bytes, peerId) => this.onPieceBytesDownloaded("p2p", bytes, peerId));
        this.p2pManager.on("bytes-uploaded", (bytes, peerId) => this.onPieceBytesUploaded("p2p", bytes, peerId));
        this.p2pManager.on("peer-connected", this.onPeerConnect);
        this.p2pManager.on("peer-closed", this.onPeerClose);
        this.p2pManager.on("tracker-update", this.onTrackerUpdate);
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
        if (this.httpRandomDownloadInterval === undefined) { // Do once on first call
            this.httpRandomDownloadInterval = setInterval(this.downloadRandomSegmentOverHttp, this.settings.httpDownloadProbabilityInterval);
            if (this.settings.httpDownloadInitialTimeout > 0 && this.settings.httpDownloadInitialTimeoutPerSegment > 0) {
                // Initialize initial HTTP download timeout (i.e. download initial segments over P2P)
                this.debugSegments("enable initial HTTP download timeout", this.settings.httpDownloadInitialTimeout, "per segment", this.settings.httpDownloadInitialTimeoutPerSegment);
                this.httpDownloadInitialTimeoutTimestamp = this.now();
                setTimeout(this.processInitialSegmentTimeout, this.settings.httpDownloadInitialTimeoutPerSegment + 100);
            }
        }
        this.p2pManager.setSwarmId(swarmId);
        this.debug("load segments");
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
        this.segmentsQueue = segments;
        updateSegmentsMap = this.processSegmentsQueue() || updateSegmentsMap;
        updateSegmentsMap = this.collectGarbage() || updateSegmentsMap;
        if (updateSegmentsMap && !this.settings.consumeOnly) {
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
        if (this.httpRandomDownloadInterval !== undefined) {
            clearInterval(this.httpRandomDownloadInterval);
            this.httpRandomDownloadInterval = undefined;
        }
        this.initialDownloadedViaP2PSegmentsCount = 0;
        this.httpDownloadInitialTimeoutTimestamp = -Infinity;
        this.segmentsQueue = [];
        this.httpManager.destroy();
        this.p2pManager.destroy();
        this.segments.clear();
    }
    processSegmentsQueue() {
        this.debugSegments("process segments queue. priority", this.segmentsQueue.length > 0 ? this.segmentsQueue[0].priority : 0);
        let updateSegmentsMap = false;
        let segmentsMap;
        let httpAllowed = true;
        if (this.httpDownloadInitialTimeoutTimestamp !== -Infinity) {
            const httpTimeout = this.now() - this.httpDownloadInitialTimeoutTimestamp;
            httpAllowed =
                (httpTimeout >= (this.initialDownloadedViaP2PSegmentsCount + 1) * this.settings.httpDownloadInitialTimeoutPerSegment) ||
                    (httpTimeout >= this.settings.httpDownloadInitialTimeout);
            if (httpAllowed) {
                this.debugSegments("cancel initial HTTP download timeout - timed out");
                this.httpDownloadInitialTimeoutTimestamp = -Infinity;
            }
        }
        for (let index = 0; index < this.segmentsQueue.length; index++) {
            const segment = this.segmentsQueue[index];
            if (this.segments.has(segment.id) || this.httpManager.isDownloading(segment)) {
                continue;
            }
            if (segment.priority <= this.settings.requiredSegmentsPriority && httpAllowed && !this.httpManager.isFailed(segment)) {
                // Download required segments over HTTP
                if (this.httpManager.getActiveDownloadsCount() >= this.settings.simultaneousHttpDownloads) {
                    // Not enough HTTP download resources. Abort one of the HTTP downloads.
                    for (let i = this.segmentsQueue.length - 1; i > index; i--) {
                        const segmentToAbort = this.segmentsQueue[i];
                        if (this.httpManager.isDownloading(segmentToAbort)) {
                            this.debugSegments("cancel HTTP download", segmentToAbort.priority, segmentToAbort.url);
                            this.httpManager.abort(segmentToAbort);
                            break;
                        }
                    }
                }
                if (this.httpManager.getActiveDownloadsCount() < this.settings.simultaneousHttpDownloads) {
                    // Abort P2P download of the required segment if any and force HTTP download
                    this.p2pManager.abort(segment);
                    this.httpManager.download(segment);
                    this.debugSegments("HTTP download (priority)", segment.priority, segment.url);
                    updateSegmentsMap = true;
                    continue;
                }
            }
            if (this.p2pManager.isDownloading(segment)) {
                continue;
            }
            if (segment.priority <= this.settings.requiredSegmentsPriority) { // Download required segments over P2P
                segmentsMap = segmentsMap ? segmentsMap : this.p2pManager.getOvrallSegmentsMap();
                if (segmentsMap.get(segment.id) !== media_peer_1.MediaPeerSegmentStatus.Loaded) {
                    continue;
                }
                if (this.p2pManager.getActiveDownloadsCount() >= this.settings.simultaneousP2PDownloads) {
                    // Not enough P2P download resources. Abort one of the P2P downloads.
                    for (let i = this.segmentsQueue.length - 1; i > index; i--) {
                        const segmentToAbort = this.segmentsQueue[i];
                        if (this.p2pManager.isDownloading(segmentToAbort)) {
                            this.debugSegments("cancel P2P download", segmentToAbort.priority, segmentToAbort.url);
                            this.p2pManager.abort(segmentToAbort);
                            break;
                        }
                    }
                }
                if (this.p2pManager.getActiveDownloadsCount() < this.settings.simultaneousP2PDownloads) {
                    if (this.p2pManager.download(segment)) {
                        this.debugSegments("P2P download (priority)", segment.priority, segment.url);
                        continue;
                    }
                }
                continue;
            }
            if (this.p2pManager.getActiveDownloadsCount() < this.settings.simultaneousP2PDownloads &&
                segment.priority <= this.settings.p2pDownloadMaxPriority) {
                if (this.p2pManager.download(segment)) {
                    this.debugSegments("P2P download", segment.priority, segment.url);
                }
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
        const segmentsMap = new Map();
        function addSegmentToMap(swarmWithSegmentId, status) {
            // For now we rely on common format of segment ID = swarm ID + segment ID
            // TODO: in next major relese segment should contain swarm ID and segment ID in the swarm fields.
            const separatorIndex = swarmWithSegmentId.lastIndexOf("+");
            const swarmId = swarmWithSegmentId.substring(0, separatorIndex);
            const segmentId = swarmWithSegmentId.substring(separatorIndex + 1);
            let segmentsStatuses = segmentsMap.get(swarmId);
            if (!segmentsStatuses) {
                segmentsStatuses = [[], []];
                segmentsMap.set(swarmId, segmentsStatuses);
            }
            segmentsStatuses[0].push(segmentId);
            segmentsStatuses[1].push(status);
        }
        for (const segmentId of this.segments.keys()) {
            addSegmentToMap(segmentId, media_peer_1.MediaPeerSegmentStatus.Loaded);
        }
        for (const segmentId of this.httpManager.getActiveDownloadsKeys()) {
            addSegmentToMap(segmentId, media_peer_1.MediaPeerSegmentStatus.LoadingByHttp);
        }
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
