"use strict";
/**
 * @license Apache-2.0
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
var loader_interface_1 = require("./loader-interface");
exports.Events = loader_interface_1.Events;
exports.Segment = loader_interface_1.Segment;
var hybrid_loader_1 = require("./hybrid-loader");
exports.HybridLoader = hybrid_loader_1.default;
exports.version = typeof (__P2PML_VERSION__) === "undefined" ? "__VERSION__" : __P2PML_VERSION__;
