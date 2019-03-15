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
const stringly_typed_event_emitter_1 = require("./stringly-typed-event-emitter");
const buffer_1 = require("buffer");
var MediaPeerCommands;
(function (MediaPeerCommands) {
    MediaPeerCommands["SegmentData"] = "segment_data";
    MediaPeerCommands["SegmentAbsent"] = "segment_absent";
    MediaPeerCommands["SegmentsMap"] = "segments_map";
    MediaPeerCommands["SegmentRequest"] = "segment_request";
    MediaPeerCommands["CancelSegmentRequest"] = "cancel_segment_request";
})(MediaPeerCommands || (MediaPeerCommands = {}));
var MediaPeerSegmentStatus;
(function (MediaPeerSegmentStatus) {
    MediaPeerSegmentStatus["Loaded"] = "loaded";
    MediaPeerSegmentStatus["LoadingByHttp"] = "loading_by_http";
})(MediaPeerSegmentStatus = exports.MediaPeerSegmentStatus || (exports.MediaPeerSegmentStatus = {}));
class DownloadingSegment {
    constructor(id, size) {
        this.id = id;
        this.size = size;
        this.bytesDownloaded = 0;
        this.pieces = [];
    }
}
class MediaPeer extends stringly_typed_event_emitter_1.default {
    constructor(peer, settings) {
        super();
        this.peer = peer;
        this.settings = settings;
        this.remoteAddress = "";
        this.downloadingSegmentId = null;
        this.downloadingSegment = null;
        this.segmentsMap = new Map();
        this.debug = Debug("p2pml:media-peer");
        this.timer = null;
        this.peer.on("connect", () => this.onPeerConnect());
        this.peer.on("close", () => this.onPeerClose());
        this.peer.on("error", (error) => this.debug("peer error", this.id, error, this));
        this.peer.on("data", (data) => this.onPeerData(data));
        this.id = peer.id;
    }
    onPeerConnect() {
        this.debug("peer connect", this.id, this);
        this.remoteAddress = this.peer.remoteAddress;
        this.emit("connect", this);
    }
    onPeerClose() {
        this.debug("peer close", this.id, this);
        this.terminateSegmentRequest();
        this.emit("close", this);
    }
    receiveSegmentPiece(data) {
        if (!this.downloadingSegment) {
            // The segment was not requested or canceled
            this.debug("peer segment not requested", this.id, this);
            return;
        }
        this.downloadingSegment.bytesDownloaded += data.byteLength;
        this.downloadingSegment.pieces.push(data);
        this.emit("bytes-downloaded", this, data.byteLength);
        const segmentId = this.downloadingSegment.id;
        if (this.downloadingSegment.bytesDownloaded == this.downloadingSegment.size) {
            const segmentData = new Uint8Array(this.downloadingSegment.size);
            let offset = 0;
            for (const piece of this.downloadingSegment.pieces) {
                segmentData.set(new Uint8Array(piece), offset);
                offset += piece.byteLength;
            }
            this.debug("peer segment download done", this.id, segmentId, this);
            this.terminateSegmentRequest();
            this.emit("segment-loaded", this, segmentId, segmentData.buffer);
        }
        else if (this.downloadingSegment.bytesDownloaded > this.downloadingSegment.size) {
            this.debug("peer segment download bytes mismatch", this.id, segmentId, this);
            this.terminateSegmentRequest();
            this.emit("segment-error", this, segmentId, "Too many bytes received for segment");
        }
    }
    getJsonCommand(data) {
        const bytes = new Uint8Array(data);
        // Serialized JSON string check by first, second and last characters: '{" .... }'
        if (bytes[0] == 123 && bytes[1] == 34 && bytes[data.byteLength - 1] == 125) {
            try {
                return JSON.parse(new TextDecoder().decode(data));
            }
            catch (_a) {
            }
        }
        return null;
    }
    onPeerData(data) {
        const command = this.getJsonCommand(data);
        if (command == null) {
            this.receiveSegmentPiece(data);
            return;
        }
        if (this.downloadingSegment) {
            this.debug("peer segment download is interrupted by a command", this.id, this);
            const segmentId = this.downloadingSegment.id;
            this.terminateSegmentRequest();
            this.emit("segment-error", this, segmentId, "Segment download is interrupted by a command");
            return;
        }
        this.debug("peer receive command", this.id, command, this);
        switch (command.command) {
            case MediaPeerCommands.SegmentsMap:
                this.segmentsMap = new Map(command.segments);
                this.emit("data-updated");
                break;
            case MediaPeerCommands.SegmentRequest:
                this.emit("segment-request", this, command.segment_id);
                break;
            case MediaPeerCommands.SegmentData:
                if (this.downloadingSegmentId === command.segment_id) {
                    this.downloadingSegment = new DownloadingSegment(command.segment_id, command.segment_size);
                    this.cancelResponseTimeoutTimer();
                }
                break;
            case MediaPeerCommands.SegmentAbsent:
                if (this.downloadingSegmentId === command.segment_id) {
                    this.terminateSegmentRequest();
                    this.segmentsMap.delete(command.segment_id);
                    this.emit("segment-absent", this, command.segment_id);
                }
                break;
            case MediaPeerCommands.CancelSegmentRequest:
                // TODO: peer stop sending buffer
                break;
            default:
                break;
        }
    }
    sendCommand(command) {
        this.debug("peer send command", this.id, command, this);
        this.peer.write(JSON.stringify(command));
    }
    destroy() {
        this.debug("peer destroy", this.id, this);
        this.terminateSegmentRequest();
        this.peer.destroy();
    }
    getDownloadingSegmentId() {
        return this.downloadingSegmentId;
    }
    getSegmentsMap() {
        return this.segmentsMap;
    }
    sendSegmentsMap(segments) {
        this.sendCommand({ "command": MediaPeerCommands.SegmentsMap, "segments": segments });
    }
    sendSegmentData(segmentId, data) {
        this.sendCommand({
            "command": MediaPeerCommands.SegmentData,
            "segment_id": segmentId,
            "segment_size": data.byteLength
        });
        let bytesLeft = data.byteLength;
        while (bytesLeft > 0) {
            const bytesToSend = (bytesLeft >= this.settings.webRtcMaxMessageSize ? this.settings.webRtcMaxMessageSize : bytesLeft);
            const buffer = buffer_1.Buffer.from(data, data.byteLength - bytesLeft, bytesToSend);
            this.peer.write(buffer);
            bytesLeft -= bytesToSend;
        }
        this.emit("bytes-uploaded", this, data.byteLength);
    }
    sendSegmentAbsent(segmentId) {
        this.sendCommand({ "command": MediaPeerCommands.SegmentAbsent, "segment_id": segmentId });
    }
    requestSegment(segmentId) {
        if (this.downloadingSegmentId) {
            throw new Error("A segment is already downloading: " + this.downloadingSegmentId);
        }
        this.sendCommand({ "command": MediaPeerCommands.SegmentRequest, "segment_id": segmentId });
        this.downloadingSegmentId = segmentId;
        this.runResponseTimeoutTimer();
    }
    cancelSegmentRequest() {
        if (this.downloadingSegmentId) {
            const segmentId = this.downloadingSegmentId;
            this.terminateSegmentRequest();
            this.sendCommand({ "command": MediaPeerCommands.CancelSegmentRequest, "segment_id": segmentId });
        }
    }
    runResponseTimeoutTimer() {
        this.timer = setTimeout(() => {
            this.timer = null;
            if (!this.downloadingSegmentId) {
                return;
            }
            const segmentId = this.downloadingSegmentId;
            this.cancelSegmentRequest();
            this.emit("segment-timeout", this, segmentId); // TODO: send peer not responding event
        }, this.settings.p2pSegmentDownloadTimeout);
    }
    cancelResponseTimeoutTimer() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
    terminateSegmentRequest() {
        this.downloadingSegmentId = null;
        this.downloadingSegment = null;
        this.cancelResponseTimeoutTimer();
    }
}
exports.MediaPeer = MediaPeer;
