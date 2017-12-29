(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.Rusha = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
var bundleFn = arguments[3];
var sources = arguments[4];
var cache = arguments[5];

var stringify = JSON.stringify;

module.exports = function (fn, options) {
    var wkey;
    var cacheKeys = Object.keys(cache);

    for (var i = 0, l = cacheKeys.length; i < l; i++) {
        var key = cacheKeys[i];
        var exp = cache[key].exports;
        // Using babel as a transpiler to use esmodule, the export will always
        // be an object with the default export as a property of it. To ensure
        // the existing api and babel esmodule exports are both supported we
        // check for both
        if (exp === fn || exp && exp.default === fn) {
            wkey = key;
            break;
        }
    }

    if (!wkey) {
        wkey = Math.floor(Math.pow(16, 8) * Math.random()).toString(16);
        var wcache = {};
        for (var i = 0, l = cacheKeys.length; i < l; i++) {
            var key = cacheKeys[i];
            wcache[key] = key;
        }
        sources[wkey] = [
            'function(require,module,exports){' + fn + '(self); }',
            wcache
        ];
    }
    var skey = Math.floor(Math.pow(16, 8) * Math.random()).toString(16);

    var scache = {}; scache[wkey] = wkey;
    sources[skey] = [
        'function(require,module,exports){' +
            // try to call default if defined to also support babel esmodule exports
            'var f = require(' + stringify(wkey) + ');' +
            '(f.default ? f.default : f)(self);' +
        '}',
        scache
    ];

    var workerSources = {};
    resolveSources(skey);

    function resolveSources(key) {
        workerSources[key] = true;

        for (var depPath in sources[key][1]) {
            var depKey = sources[key][1][depPath];
            if (!workerSources[depKey]) {
                resolveSources(depKey);
            }
        }
    }

    var src = '(' + bundleFn + ')({'
        + Object.keys(workerSources).map(function (key) {
            return stringify(key) + ':['
                + sources[key][0]
                + ',' + stringify(sources[key][1]) + ']'
            ;
        }).join(',')
        + '},{},[' + stringify(skey) + '])'
    ;

    var URL = window.URL || window.webkitURL || window.mozURL || window.msURL;

    var blob = new Blob([src], { type: 'text/javascript' });
    if (options && options.bare) { return blob; }
    var workerUrl = URL.createObjectURL(blob);
    var worker = new Worker(workerUrl);
    worker.objectURL = workerUrl;
    return worker;
};

},{}],2:[function(_dereq_,module,exports){
(function (global){
"use strict";
/* eslint-env commonjs, browser */

var reader = void 0;
if (typeof self !== 'undefined' && typeof self.FileReaderSync !== 'undefined') {
  reader = new self.FileReaderSync();
}

// Convert a binary string and write it to the heap.
// A binary string is expected to only contain char codes < 256.
var convStr = function (str, H8, H32, start, len, off) {
  var i = void 0,
      om = off % 4,
      lm = (len + om) % 4,
      j = len - lm;
  switch (om) {
    case 0:
      H8[off] = str.charCodeAt(start + 3);
    case 1:
      H8[off + 1 - (om << 1) | 0] = str.charCodeAt(start + 2);
    case 2:
      H8[off + 2 - (om << 1) | 0] = str.charCodeAt(start + 1);
    case 3:
      H8[off + 3 - (om << 1) | 0] = str.charCodeAt(start);
  }
  if (len < lm + (4 - om)) {
    return;
  }
  for (i = 4 - om; i < j; i = i + 4 | 0) {
    H32[off + i >> 2] = str.charCodeAt(start + i) << 24 | str.charCodeAt(start + i + 1) << 16 | str.charCodeAt(start + i + 2) << 8 | str.charCodeAt(start + i + 3);
  }
  switch (lm) {
    case 3:
      H8[off + j + 1 | 0] = str.charCodeAt(start + j + 2);
    case 2:
      H8[off + j + 2 | 0] = str.charCodeAt(start + j + 1);
    case 1:
      H8[off + j + 3 | 0] = str.charCodeAt(start + j);
  }
};

// Convert a buffer or array and write it to the heap.
// The buffer or array is expected to only contain elements < 256.
var convBuf = function (buf, H8, H32, start, len, off) {
  var i = void 0,
      om = off % 4,
      lm = (len + om) % 4,
      j = len - lm;
  switch (om) {
    case 0:
      H8[off] = buf[start + 3];
    case 1:
      H8[off + 1 - (om << 1) | 0] = buf[start + 2];
    case 2:
      H8[off + 2 - (om << 1) | 0] = buf[start + 1];
    case 3:
      H8[off + 3 - (om << 1) | 0] = buf[start];
  }
  if (len < lm + (4 - om)) {
    return;
  }
  for (i = 4 - om; i < j; i = i + 4 | 0) {
    H32[off + i >> 2 | 0] = buf[start + i] << 24 | buf[start + i + 1] << 16 | buf[start + i + 2] << 8 | buf[start + i + 3];
  }
  switch (lm) {
    case 3:
      H8[off + j + 1 | 0] = buf[start + j + 2];
    case 2:
      H8[off + j + 2 | 0] = buf[start + j + 1];
    case 1:
      H8[off + j + 3 | 0] = buf[start + j];
  }
};

var convBlob = function (blob, H8, H32, start, len, off) {
  var i = void 0,
      om = off % 4,
      lm = (len + om) % 4,
      j = len - lm;
  var buf = new Uint8Array(reader.readAsArrayBuffer(blob.slice(start, start + len)));
  switch (om) {
    case 0:
      H8[off] = buf[3];
    case 1:
      H8[off + 1 - (om << 1) | 0] = buf[2];
    case 2:
      H8[off + 2 - (om << 1) | 0] = buf[1];
    case 3:
      H8[off + 3 - (om << 1) | 0] = buf[0];
  }
  if (len < lm + (4 - om)) {
    return;
  }
  for (i = 4 - om; i < j; i = i + 4 | 0) {
    H32[off + i >> 2 | 0] = buf[i] << 24 | buf[i + 1] << 16 | buf[i + 2] << 8 | buf[i + 3];
  }
  switch (lm) {
    case 3:
      H8[off + j + 1 | 0] = buf[j + 2];
    case 2:
      H8[off + j + 2 | 0] = buf[j + 1];
    case 1:
      H8[off + j + 3 | 0] = buf[j];
  }
};

module.exports = function (data, H8, H32, start, len, off) {
  if (typeof data === 'string') {
    return convStr(data, H8, H32, start, len, off);
  }
  if (data instanceof Array) {
    return convBuf(data, H8, H32, start, len, off);
  }
  if (global.Buffer && global.Buffer.isBuffer(data)) {
    return convBuf(data, H8, H32, start, len, off);
  }
  if (data instanceof ArrayBuffer) {
    return convBuf(new Uint8Array(data), H8, H32, start, len, off);
  }
  if (data.buffer instanceof ArrayBuffer) {
    return convBuf(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), H8, H32, start, len, off);
  }
  if (data instanceof Blob) {
    return convBlob(data, H8, H32, start, len, off);
  }
  throw new Error('Unsupported data type.');
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],3:[function(_dereq_,module,exports){
'use strict';
// The low-level RushCore module provides the heart of Rusha,
// a high-speed sha1 implementation working on an Int32Array heap.
// At first glance, the implementation seems complicated, however
// with the SHA1 spec at hand, it is obvious this almost a textbook
// implementation that has a few functions hand-inlined and a few loops
// hand-unrolled.
module.exports = function RushaCore(stdlib$1186, foreign$1187, heap$1188) {
    'use asm';
    var H$1189 = new stdlib$1186.Int32Array(heap$1188);
    function hash$1190(k$1191, x$1192) {
        // k in bytes
        k$1191 = k$1191 | 0;
        x$1192 = x$1192 | 0;
        var i$1193 = 0, j$1194 = 0, y0$1195 = 0, z0$1196 = 0, y1$1197 = 0, z1$1198 = 0, y2$1199 = 0, z2$1200 = 0, y3$1201 = 0, z3$1202 = 0, y4$1203 = 0, z4$1204 = 0, t0$1205 = 0, t1$1206 = 0;
        y0$1195 = H$1189[x$1192 + 320 >> 2] | 0;
        y1$1197 = H$1189[x$1192 + 324 >> 2] | 0;
        y2$1199 = H$1189[x$1192 + 328 >> 2] | 0;
        y3$1201 = H$1189[x$1192 + 332 >> 2] | 0;
        y4$1203 = H$1189[x$1192 + 336 >> 2] | 0;
        for (i$1193 = 0; (i$1193 | 0) < (k$1191 | 0); i$1193 = i$1193 + 64 | 0) {
            z0$1196 = y0$1195;
            z1$1198 = y1$1197;
            z2$1200 = y2$1199;
            z3$1202 = y3$1201;
            z4$1204 = y4$1203;
            for (j$1194 = 0; (j$1194 | 0) < 64; j$1194 = j$1194 + 4 | 0) {
                t1$1206 = H$1189[i$1193 + j$1194 >> 2] | 0;
                t0$1205 = ((y0$1195 << 5 | y0$1195 >>> 27) + (y1$1197 & y2$1199 | ~y1$1197 & y3$1201) | 0) + ((t1$1206 + y4$1203 | 0) + 1518500249 | 0) | 0;
                y4$1203 = y3$1201;
                y3$1201 = y2$1199;
                y2$1199 = y1$1197 << 30 | y1$1197 >>> 2;
                y1$1197 = y0$1195;
                y0$1195 = t0$1205;
                H$1189[k$1191 + j$1194 >> 2] = t1$1206;
            }
            for (j$1194 = k$1191 + 64 | 0; (j$1194 | 0) < (k$1191 + 80 | 0); j$1194 = j$1194 + 4 | 0) {
                t1$1206 = (H$1189[j$1194 - 12 >> 2] ^ H$1189[j$1194 - 32 >> 2] ^ H$1189[j$1194 - 56 >> 2] ^ H$1189[j$1194 - 64 >> 2]) << 1 | (H$1189[j$1194 - 12 >> 2] ^ H$1189[j$1194 - 32 >> 2] ^ H$1189[j$1194 - 56 >> 2] ^ H$1189[j$1194 - 64 >> 2]) >>> 31;
                t0$1205 = ((y0$1195 << 5 | y0$1195 >>> 27) + (y1$1197 & y2$1199 | ~y1$1197 & y3$1201) | 0) + ((t1$1206 + y4$1203 | 0) + 1518500249 | 0) | 0;
                y4$1203 = y3$1201;
                y3$1201 = y2$1199;
                y2$1199 = y1$1197 << 30 | y1$1197 >>> 2;
                y1$1197 = y0$1195;
                y0$1195 = t0$1205;
                H$1189[j$1194 >> 2] = t1$1206;
            }
            for (j$1194 = k$1191 + 80 | 0; (j$1194 | 0) < (k$1191 + 160 | 0); j$1194 = j$1194 + 4 | 0) {
                t1$1206 = (H$1189[j$1194 - 12 >> 2] ^ H$1189[j$1194 - 32 >> 2] ^ H$1189[j$1194 - 56 >> 2] ^ H$1189[j$1194 - 64 >> 2]) << 1 | (H$1189[j$1194 - 12 >> 2] ^ H$1189[j$1194 - 32 >> 2] ^ H$1189[j$1194 - 56 >> 2] ^ H$1189[j$1194 - 64 >> 2]) >>> 31;
                t0$1205 = ((y0$1195 << 5 | y0$1195 >>> 27) + (y1$1197 ^ y2$1199 ^ y3$1201) | 0) + ((t1$1206 + y4$1203 | 0) + 1859775393 | 0) | 0;
                y4$1203 = y3$1201;
                y3$1201 = y2$1199;
                y2$1199 = y1$1197 << 30 | y1$1197 >>> 2;
                y1$1197 = y0$1195;
                y0$1195 = t0$1205;
                H$1189[j$1194 >> 2] = t1$1206;
            }
            for (j$1194 = k$1191 + 160 | 0; (j$1194 | 0) < (k$1191 + 240 | 0); j$1194 = j$1194 + 4 | 0) {
                t1$1206 = (H$1189[j$1194 - 12 >> 2] ^ H$1189[j$1194 - 32 >> 2] ^ H$1189[j$1194 - 56 >> 2] ^ H$1189[j$1194 - 64 >> 2]) << 1 | (H$1189[j$1194 - 12 >> 2] ^ H$1189[j$1194 - 32 >> 2] ^ H$1189[j$1194 - 56 >> 2] ^ H$1189[j$1194 - 64 >> 2]) >>> 31;
                t0$1205 = ((y0$1195 << 5 | y0$1195 >>> 27) + (y1$1197 & y2$1199 | y1$1197 & y3$1201 | y2$1199 & y3$1201) | 0) + ((t1$1206 + y4$1203 | 0) - 1894007588 | 0) | 0;
                y4$1203 = y3$1201;
                y3$1201 = y2$1199;
                y2$1199 = y1$1197 << 30 | y1$1197 >>> 2;
                y1$1197 = y0$1195;
                y0$1195 = t0$1205;
                H$1189[j$1194 >> 2] = t1$1206;
            }
            for (j$1194 = k$1191 + 240 | 0; (j$1194 | 0) < (k$1191 + 320 | 0); j$1194 = j$1194 + 4 | 0) {
                t1$1206 = (H$1189[j$1194 - 12 >> 2] ^ H$1189[j$1194 - 32 >> 2] ^ H$1189[j$1194 - 56 >> 2] ^ H$1189[j$1194 - 64 >> 2]) << 1 | (H$1189[j$1194 - 12 >> 2] ^ H$1189[j$1194 - 32 >> 2] ^ H$1189[j$1194 - 56 >> 2] ^ H$1189[j$1194 - 64 >> 2]) >>> 31;
                t0$1205 = ((y0$1195 << 5 | y0$1195 >>> 27) + (y1$1197 ^ y2$1199 ^ y3$1201) | 0) + ((t1$1206 + y4$1203 | 0) - 899497514 | 0) | 0;
                y4$1203 = y3$1201;
                y3$1201 = y2$1199;
                y2$1199 = y1$1197 << 30 | y1$1197 >>> 2;
                y1$1197 = y0$1195;
                y0$1195 = t0$1205;
                H$1189[j$1194 >> 2] = t1$1206;
            }
            y0$1195 = y0$1195 + z0$1196 | 0;
            y1$1197 = y1$1197 + z1$1198 | 0;
            y2$1199 = y2$1199 + z2$1200 | 0;
            y3$1201 = y3$1201 + z3$1202 | 0;
            y4$1203 = y4$1203 + z4$1204 | 0;
        }
        H$1189[x$1192 + 320 >> 2] = y0$1195;
        H$1189[x$1192 + 324 >> 2] = y1$1197;
        H$1189[x$1192 + 328 >> 2] = y2$1199;
        H$1189[x$1192 + 332 >> 2] = y3$1201;
        H$1189[x$1192 + 336 >> 2] = y4$1203;
    }
    return { hash: hash$1190 };
};

},{}],4:[function(_dereq_,module,exports){
"use strict";
/* eslint-env commonjs, browser */

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Rusha = _dereq_('./rusha');

var _require = _dereq_('./utils'),
    toHex = _require.toHex;

var Hash = function () {
  function Hash() {
    _classCallCheck(this, Hash);

    this._rusha = new Rusha();
    this._rusha.resetState();
  }

  Hash.prototype.update = function update(data) {
    this._rusha.append(data);
    return this;
  };

  Hash.prototype.digest = function digest(encoding) {
    var digest = this._rusha.rawEnd().buffer;
    if (!encoding) {
      return digest;
    }
    if (encoding === 'hex') {
      return toHex(digest);
    }
    throw new Error('unsupported digest encoding');
  };

  return Hash;
}();

module.exports = function () {
  return new Hash();
};

},{"./rusha":6,"./utils":7}],5:[function(_dereq_,module,exports){
"use strict";
/* eslint-env commonjs, browser */

var webworkify = _dereq_('webworkify');

var Rusha = _dereq_('./rusha');
var createHash = _dereq_('./hash');
var runWorker = _dereq_('./worker');

var isRunningInDedicatedWorker = typeof FileReaderSync !== 'undefined' && typeof DedicatedWorkerGlobalScope !== 'undefined';

Rusha.disableWorkerBehaviour = isRunningInDedicatedWorker ? runWorker() : function () {};

Rusha.createWorker = function () {
  var worker = webworkify(_dereq_('./worker'));
  var terminate = worker.terminate;
  worker.terminate = function () {
    URL.revokeObjectURL(worker.objectURL);
    terminate.call(worker);
  };
  return worker;
};

Rusha.createHash = createHash;

module.exports = Rusha;

},{"./hash":4,"./rusha":6,"./worker":8,"webworkify":1}],6:[function(_dereq_,module,exports){
"use strict";
/* eslint-env commonjs, browser */

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var RushaCore = _dereq_('./core.sjs');

var _require = _dereq_('./utils'),
    toHex = _require.toHex,
    ceilHeapSize = _require.ceilHeapSize;

var conv = _dereq_('./conv');

// Calculate the length of buffer that the sha1 routine uses
// including the padding.
var padlen = function (len) {
  for (len += 9; len % 64 > 0; len += 1) {}
  return len;
};

var padZeroes = function (bin, len) {
  var h8 = new Uint8Array(bin.buffer);
  var om = len % 4,
      align = len - om;
  switch (om) {
    case 0:
      h8[align + 3] = 0;
    case 1:
      h8[align + 2] = 0;
    case 2:
      h8[align + 1] = 0;
    case 3:
      h8[align + 0] = 0;
  }
  for (var i = (len >> 2) + 1; i < bin.length; i++) {
    bin[i] = 0;
  }
};

var padData = function (bin, chunkLen, msgLen) {
  bin[chunkLen >> 2] |= 0x80 << 24 - (chunkLen % 4 << 3);
  // To support msgLen >= 2 GiB, use a float division when computing the
  // high 32-bits of the big-endian message length in bits.
  bin[((chunkLen >> 2) + 2 & ~0x0f) + 14] = msgLen / (1 << 29) | 0;
  bin[((chunkLen >> 2) + 2 & ~0x0f) + 15] = msgLen << 3;
};

var getRawDigest = function (heap, padMaxChunkLen) {
  var io = new Int32Array(heap, padMaxChunkLen + 320, 5);
  var out = new Int32Array(5);
  var arr = new DataView(out.buffer);
  arr.setInt32(0, io[0], false);
  arr.setInt32(4, io[1], false);
  arr.setInt32(8, io[2], false);
  arr.setInt32(12, io[3], false);
  arr.setInt32(16, io[4], false);
  return out;
};

var Rusha = function () {
  function Rusha(chunkSize) {
    _classCallCheck(this, Rusha);

    chunkSize = chunkSize || 64 * 1024;
    if (chunkSize % 64 > 0) {
      throw new Error('Chunk size must be a multiple of 128 bit');
    }
    this._offset = 0;
    this._maxChunkLen = chunkSize;
    this._padMaxChunkLen = padlen(chunkSize);
    // The size of the heap is the sum of:
    // 1. The padded input message size
    // 2. The extended space the algorithm needs (320 byte)
    // 3. The 160 bit state the algoritm uses
    this._heap = new ArrayBuffer(ceilHeapSize(this._padMaxChunkLen + 320 + 20));
    this._h32 = new Int32Array(this._heap);
    this._h8 = new Int8Array(this._heap);
    this._core = new RushaCore({ Int32Array: Int32Array }, {}, this._heap);
  }

  Rusha.prototype._initState = function _initState(heap, padMsgLen) {
    this._offset = 0;
    var io = new Int32Array(heap, padMsgLen + 320, 5);
    io[0] = 1732584193;
    io[1] = -271733879;
    io[2] = -1732584194;
    io[3] = 271733878;
    io[4] = -1009589776;
  };

  Rusha.prototype._padChunk = function _padChunk(chunkLen, msgLen) {
    var padChunkLen = padlen(chunkLen);
    var view = new Int32Array(this._heap, 0, padChunkLen >> 2);
    padZeroes(view, chunkLen);
    padData(view, chunkLen, msgLen);
    return padChunkLen;
  };

  Rusha.prototype._write = function _write(data, chunkOffset, chunkLen, off) {
    conv(data, this._h8, this._h32, chunkOffset, chunkLen, off || 0);
  };

  Rusha.prototype._coreCall = function _coreCall(data, chunkOffset, chunkLen, msgLen, finalize) {
    var padChunkLen = chunkLen;
    this._write(data, chunkOffset, chunkLen);
    if (finalize) {
      padChunkLen = this._padChunk(chunkLen, msgLen);
    }
    this._core.hash(padChunkLen, this._padMaxChunkLen);
  };

  Rusha.prototype.rawDigest = function rawDigest(str) {
    var msgLen = str.byteLength || str.length || str.size || 0;
    this._initState(this._heap, this._padMaxChunkLen);
    var chunkOffset = 0,
        chunkLen = this._maxChunkLen;
    for (chunkOffset = 0; msgLen > chunkOffset + chunkLen; chunkOffset += chunkLen) {
      this._coreCall(str, chunkOffset, chunkLen, msgLen, false);
    }
    this._coreCall(str, chunkOffset, msgLen - chunkOffset, msgLen, true);
    return getRawDigest(this._heap, this._padMaxChunkLen);
  };

  Rusha.prototype.digest = function digest(str) {
    return toHex(this.rawDigest(str).buffer);
  };

  Rusha.prototype.digestFromString = function digestFromString(str) {
    return this.digest(str);
  };

  Rusha.prototype.digestFromBuffer = function digestFromBuffer(str) {
    return this.digest(str);
  };

  Rusha.prototype.digestFromArrayBuffer = function digestFromArrayBuffer(str) {
    return this.digest(str);
  };

  Rusha.prototype.resetState = function resetState() {
    this._initState(this._heap, this._padMaxChunkLen);
    return this;
  };

  Rusha.prototype.append = function append(chunk) {
    var chunkOffset = 0;
    var chunkLen = chunk.byteLength || chunk.length || chunk.size || 0;
    var turnOffset = this._offset % this._maxChunkLen;
    var inputLen = void 0;

    this._offset += chunkLen;
    while (chunkOffset < chunkLen) {
      inputLen = Math.min(chunkLen - chunkOffset, this._maxChunkLen - turnOffset);
      this._write(chunk, chunkOffset, inputLen, turnOffset);
      turnOffset += inputLen;
      chunkOffset += inputLen;
      if (turnOffset === this._maxChunkLen) {
        this._core.hash(this._maxChunkLen, this._padMaxChunkLen);
        turnOffset = 0;
      }
    }
    return this;
  };

  Rusha.prototype.getState = function getState() {
    var turnOffset = this._offset % this._maxChunkLen;
    var heap = void 0;
    if (!turnOffset) {
      var io = new Int32Array(this._heap, this._padMaxChunkLen + 320, 5);
      heap = io.buffer.slice(io.byteOffset, io.byteOffset + io.byteLength);
    } else {
      heap = this._heap.slice(0);
    }
    return {
      offset: this._offset,
      heap: heap
    };
  };

  Rusha.prototype.setState = function setState(state) {
    this._offset = state.offset;
    if (state.heap.byteLength === 20) {
      var io = new Int32Array(this._heap, this._padMaxChunkLen + 320, 5);
      io.set(new Int32Array(state.heap));
    } else {
      this._h32.set(new Int32Array(state.heap));
    }
    return this;
  };

  Rusha.prototype.rawEnd = function rawEnd() {
    var msgLen = this._offset;
    var chunkLen = msgLen % this._maxChunkLen;
    var padChunkLen = this._padChunk(chunkLen, msgLen);
    this._core.hash(padChunkLen, this._padMaxChunkLen);
    var result = getRawDigest(this._heap, this._padMaxChunkLen);
    this._initState(this._heap, this._padMaxChunkLen);
    return result;
  };

  Rusha.prototype.end = function end() {
    return toHex(this.rawEnd().buffer);
  };

  return Rusha;
}();

module.exports = Rusha;
module.exports._core = RushaCore;

},{"./conv":2,"./core.sjs":3,"./utils":7}],7:[function(_dereq_,module,exports){
"use strict";
/* eslint-env commonjs, browser */

//
// toHex
//

var precomputedHex = new Array(256);
for (var i = 0; i < 256; i++) {
  precomputedHex[i] = (i < 0x10 ? '0' : '') + i.toString(16);
}

module.exports.toHex = function (arrayBuffer) {
  var binarray = new Uint8Array(arrayBuffer);
  var res = new Array(arrayBuffer.byteLength);
  for (var _i = 0; _i < res.length; _i++) {
    res[_i] = precomputedHex[binarray[_i]];
  }
  return res.join('');
};

//
// ceilHeapSize
//

module.exports.ceilHeapSize = function (v) {
  // The asm.js spec says:
  // The heap object's byteLength must be either
  // 2^n for n in [12, 24) or 2^24 * n for n ≥ 1.
  // Also, byteLengths smaller than 2^16 are deprecated.
  var p = 0;
  // If v is smaller than 2^16, the smallest possible solution
  // is 2^16.
  if (v <= 65536) return 65536;
  // If v < 2^24, we round up to 2^n,
  // otherwise we round up to 2^24 * n.
  if (v < 16777216) {
    for (p = 1; p < v; p = p << 1) {}
  } else {
    for (p = 16777216; p < v; p += 16777216) {}
  }
  return p;
};

},{}],8:[function(_dereq_,module,exports){
"use strict";
/* eslint-env commonjs, worker */

module.exports = function () {
  var Rusha = _dereq_('./rusha');

  var hashData = function (hasher, data, cb) {
    try {
      return cb(null, hasher.digest(data));
    } catch (e) {
      return cb(e);
    }
  };

  var hashFile = function (hasher, readTotal, blockSize, file, cb) {
    var reader = new self.FileReader();
    reader.onloadend = function onloadend() {
      if (reader.error) {
        return cb(reader.error);
      }
      var buffer = reader.result;
      readTotal += reader.result.byteLength;
      try {
        hasher.append(buffer);
      } catch (e) {
        cb(e);
        return;
      }
      if (readTotal < file.size) {
        hashFile(hasher, readTotal, blockSize, file, cb);
      } else {
        cb(null, hasher.end());
      }
    };
    reader.readAsArrayBuffer(file.slice(readTotal, readTotal + blockSize));
  };

  var workerBehaviourEnabled = true;

  self.onmessage = function (event) {
    if (!workerBehaviourEnabled) {
      return;
    }

    var data = event.data.data,
        file = event.data.file,
        id = event.data.id;
    if (typeof id === 'undefined') return;
    if (!file && !data) return;
    var blockSize = event.data.blockSize || 4 * 1024 * 1024;
    var hasher = new Rusha(blockSize);
    hasher.resetState();
    var done = function (err, hash) {
      if (!err) {
        self.postMessage({ id: id, hash: hash });
      } else {
        self.postMessage({ id: id, error: err.name });
      }
    };
    if (data) hashData(hasher, data, done);
    if (file) hashFile(hasher, 0, blockSize, file, done);
  };

  return function () {
    workerBehaviourEnabled = false;
  };
};

},{"./rusha":6}]},{},[5])(5)
});