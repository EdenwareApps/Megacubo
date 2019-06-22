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
import { LoaderInterface, Segment, SegmentValidatorCallback, XhrSetupCallback, SegmentUrlBuilder } from "./loader-interface";
import { EventEmitter } from "events";
export default class HybridLoader extends EventEmitter implements LoaderInterface {
    private readonly debug;
    private readonly debugSegments;
    private readonly httpManager;
    private readonly p2pManager;
    private readonly segments;
    private segmentsQueue;
    private readonly speedApproximator;
    private readonly settings;
    private httpRandomDownloadInterval;
    private httpDownloadInitialTimeoutTimestamp;
    private initialDownloadedViaP2PSegmentsCount;
    static isSupported(): boolean;
    constructor(settings?: any);
    private createHttpManager;
    private createP2PManager;
    load(segments: Segment[], swarmId: string): void;
    getSegment(id: string): Segment | undefined;
    getSettings(): Settings;
    getDetails(): {
        peerId: string;
    };
    destroy(): void;
    private processInitialSegmentTimeout;
    private processSegmentsQueue;
    private downloadRandomSegmentOverHttp;
    private onPieceBytesDownloaded;
    private onPieceBytesUploaded;
    private onSegmentLoaded;
    private onSegmentError;
    private emitSegmentLoaded;
    private createSegmentsMap;
    private onPeerConnect;
    private onPeerClose;
    private onTrackerUpdate;
    private collectGarbage;
    private now;
}
interface Settings {
    /**
     * Segment lifetime in cache. The segment is deleted from the cache if the last access time is greater than this value (in milliseconds).
     */
    cachedSegmentExpiration: number;
    /**
     * Max number of segments that can be stored in the cache.
     */
    cachedSegmentsCount: number;
    /**
     * Enable/Disable peers interaction.
     */
    useP2P: boolean;
    /**
     * The peer will not upload segments data to the P2P network but still download from others.
     */
    consumeOnly: boolean;
    /**
     * The maximum priority of the segments to be downloaded (if not available) as quickly as possible (i.e. via HTTP method).
     */
    requiredSegmentsPriority: number;
    /**
     * Max number of simultaneous downloads from HTTP source.
     */
    simultaneousHttpDownloads: number;
    /**
     * Probability of downloading remaining not downloaded segment in the segments queue via HTTP.
     */
    httpDownloadProbability: number;
    /**
     * Interval of the httpDownloadProbability check (in milliseconds).
     */
    httpDownloadProbabilityInterval: number;
    /**
     * Don't download segments over HTTP randomly when there is no peers.
     */
    httpDownloadProbabilitySkipIfNoPeers: boolean;
    /**
     * Timeout before trying to load segment again via HTTP after failed attempt (in milliseconds).
     */
    httpFailedSegmentTimeout: number;
    /**
     * Segments with higher priority will not be downloaded over HTTP.
     */
    httpDownloadMaxPriority: number;
    /**
     * Try to download initial segments over P2P if the value is > 0.
     * But HTTP download will be forcibly enabled if there is no peers on tracker or
     * single sequential segment P2P download is timed out (see httpDownloadInitialTimeoutPerSegment).
     */
    httpDownloadInitialTimeout: number;
    /**
     * If initial HTTP download timeout is enabled (see httpDownloadInitialTimeout)
     * this parameter sets additional timeout for a single sequential segment download
     * over P2P. It will cancel initial HTTP download timeout mode if a segment download is timed out.
     */
    httpDownloadInitialTimeoutPerSegment: number;
    /**
     * Max number of simultaneous downloads from peers.
     */
    simultaneousP2PDownloads: number;
    /**
     * Segments with higher priority will not be downloaded over P2P.
     */
    p2pDownloadMaxPriority: number;
    /**
     * Timeout to download a segment from a peer. If exceeded the peer is dropped.
     */
    p2pSegmentDownloadTimeout: number;
    /**
     * Max WebRTC message size. 64KiB - 1B should work with most of recent browsers. Set it to 16KiB for older browsers support.
     */
    webRtcMaxMessageSize: number;
    /**
     * Torrent trackers (announcers) to use.
     */
    trackerAnnounce: string[];
    /**
     * An RTCConfiguration dictionary providing options to configure WebRTC connections.
     */
    rtcConfig: any;
    /**
     * Segment validation callback - validates the data after it has been downloaded.
     */
    segmentValidator?: SegmentValidatorCallback;
    /**
     * XMLHttpRequest setup callback. Handle it when you need additional setup for requests made by the library.
     */
    xhrSetup?: XhrSetupCallback;
    /**
     * Allow to modify the segment URL before HTTP request.
     */
    segmentUrlBuilder?: SegmentUrlBuilder;
}
export {};
