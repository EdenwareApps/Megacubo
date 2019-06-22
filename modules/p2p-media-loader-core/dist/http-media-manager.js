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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const Debug = require("debug");
const stringly_typed_event_emitter_1 = require("./stringly-typed-event-emitter");
const loader_interface_1 = require("./loader-interface");
class HttpMediaManager extends stringly_typed_event_emitter_1.default {
    constructor(settings) {
        super();
        this.settings = settings;
        this.xhrRequests = new Map();
        this.failedSegments = new Map();
        this.debug = Debug("p2pml:http-media-manager");
        this.now = () => performance.now();
    }
    download(segment) {
        if (this.isDownloading(segment)) {
            return;
        }
        this.cleanTimedOutFailedSegments();
        const segmentUrl = this.settings.segmentUrlBuilder
            ? this.settings.segmentUrlBuilder(segment)
            : segment.url;
        this.debug("http segment download", segmentUrl);
        const xhr = new XMLHttpRequest();
        xhr.open("GET", segmentUrl, true);
        xhr.responseType = "arraybuffer";
        if (segment.range) {
            xhr.setRequestHeader("Range", segment.range);
        }
        this.setupXhrEvents(xhr, segment);
        if (this.settings.xhrSetup) {
            this.settings.xhrSetup(xhr, segmentUrl);
        }
        this.xhrRequests.set(segment.id, xhr);
        xhr.send();
    }
    abort(segment) {
        const xhr = this.xhrRequests.get(segment.id);
        if (xhr) {
            xhr.abort();
            this.xhrRequests.delete(segment.id);
            this.debug("http segment abort", segment.id);
        }
    }
    isDownloading(segment) {
        return this.xhrRequests.has(segment.id);
    }
    isFailed(segment) {
        const time = this.failedSegments.get(segment.id);
        return time !== undefined && time > this.now();
    }
    getActiveDownloadsKeys() {
        return [...this.xhrRequests.keys()];
    }
    getActiveDownloadsCount() {
        return this.xhrRequests.size;
    }
    destroy() {
        this.xhrRequests.forEach(xhr => xhr.abort());
        this.xhrRequests.clear();
    }
    setupXhrEvents(xhr, segment) {
        let prevBytesLoaded = 0;
        xhr.addEventListener("progress", (event) => {
            const bytesLoaded = event.loaded - prevBytesLoaded;
            this.emit("bytes-downloaded", bytesLoaded);
            prevBytesLoaded = event.loaded;
        });
        xhr.addEventListener("load", (event) => __awaiter(this, void 0, void 0, function* () {
            if (event.target.status >= 200 && 300 > event.target.status) {
                yield this.segmentDownloadFinished(segment, event.target.response);
            }
            else {
                this.segmentFailure(segment, event);
            }
        }));
        xhr.addEventListener("error", (event) => {
            this.segmentFailure(segment, event);
        });
    }
    segmentDownloadFinished(segment, data) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.settings.segmentValidator) {
                try {
                    yield this.settings.segmentValidator(new loader_interface_1.Segment(segment.id, segment.url, segment.range, segment.priority, data), "http");
                }
                catch (error) {
                    this.debug("segment validator failed", error);
                    this.segmentFailure(segment, error);
                    return;
                }
            }
            this.xhrRequests.delete(segment.id);
            this.emit("segment-loaded", segment, data);
        });
    }
    segmentFailure(segment, error) {
        this.xhrRequests.delete(segment.id);
        this.failedSegments.set(segment.id, this.now() + this.settings.httpFailedSegmentTimeout);
        this.emit("segment-error", segment, error);
    }
    cleanTimedOutFailedSegments() {
        const now = this.now();
        const candidates = [];
        this.failedSegments.forEach((time, id) => {
            if (time < now) {
                candidates.push(id);
            }
        });
        candidates.forEach(id => this.failedSegments.delete(id));
    }
}
exports.HttpMediaManager = HttpMediaManager;
