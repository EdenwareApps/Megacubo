'use strict';

const assert = require('assert');

const asm = require('asm.js');

const Rusha = require('../../dist/rusha.js');

const assertBytesEqual = (buffer1, buffer2) => {
  const v1 = new Int8Array(buffer1);
  const v2 = new Int8Array(buffer2);
  assert.strictEqual(v1.length, v2.length, 'Buffers do not have the same length');
  for (let i = 0; i < v1.length; i++) {
    assert.strictEqual(v1[i], v2[i], 'Item at ' + i + ' differs: ' + v1[i] + ' vs ' + v2[i]);
  }
};

const digestAppendOneByOne = (input) => {
  let middleState;   
  for (let i = 0, len = (input.byteLength || input.length); i < len; i++) {
    if (i !== 0){
      r.setState(middleState);
    } else {
      r.resetState();
    }
    middleState = r.append(input.slice(i, i + 1)).getState();
  }
  return r.setState(middleState).end();
};

const r = new Rusha();

const abcString = 'abc';
let abcBuffer;
const abcArray = [97, 98, 99];
const abcArrayBuffer = new Int8Array(abcArray).buffer;

if (typeof Buffer === 'function') {
  abcBuffer = new Buffer('abc', 'ascii');
} else {
  abcBuffer = new Int8Array(abcArray);
}

const abcHashedInt32Array = new Int32Array(new Int8Array([0xA9, 0x99, 0x3E, 0x36, 0x47, 0x06, 0x81, 0x6A, 0xBA, 0x3E, 0x25, 0x71, 0x78, 0x50, 0xC2, 0x6C, 0x9C, 0xD0, 0xD8, 0x9D]).buffer);

describe('Rusha', () => {
  it('is valid asm.js', () => {
    assert(asm.validate(Rusha._core.toString()));
  });

  describe('digestAppendOneByOne', () => {
    it('returns hex string from string', () => {
      assert.strictEqual('a9993e364706816aba3e25717850c26c9cd0d89d', digestAppendOneByOne(abcString));
    });
    it('returns hex string from buffer', () => {
      assert.strictEqual('a9993e364706816aba3e25717850c26c9cd0d89d', digestAppendOneByOne(abcBuffer));
    });
    it('returns hex string from array', () => {
      assert.strictEqual('a9993e364706816aba3e25717850c26c9cd0d89d', digestAppendOneByOne(abcArray));
    });
    it('returns hex string from ArrayBuffer', () => {
      assert.strictEqual('a9993e364706816aba3e25717850c26c9cd0d89d', digestAppendOneByOne(abcArrayBuffer));
    });
  });

  describe('digest', () => {
    it('returns hex string from string', () => {
      assert.strictEqual('a9993e364706816aba3e25717850c26c9cd0d89d', r.digest(abcString));
    });
    it('returns hex string from buffer', () => {
      assert.strictEqual('a9993e364706816aba3e25717850c26c9cd0d89d', r.digest(abcBuffer));
    });
    it('returns hex string from array', () => {
      assert.strictEqual('a9993e364706816aba3e25717850c26c9cd0d89d', r.digest(abcArray));
    });
    it('returns hex string from ArrayBuffer', () => {
      assert.strictEqual('a9993e364706816aba3e25717850c26c9cd0d89d', r.digest(abcArrayBuffer));
    });
  });

  describe('digestFromString', () => {
    it('returns hex string from string', () => {
      assert.strictEqual('a9993e364706816aba3e25717850c26c9cd0d89d', r.digestFromString(abcString));
    });
  });

  describe('digestFromBuffer', () => {
    it('returns hex string from buffer', () => {
      assert.strictEqual('a9993e364706816aba3e25717850c26c9cd0d89d', r.digestFromBuffer(abcBuffer));
    });
    it('returns hex string from array', () => {
      assert.strictEqual('a9993e364706816aba3e25717850c26c9cd0d89d', r.digestFromBuffer(abcArray));
    });
  });

  describe('digestFromArrayBuffer', () => {
    it('returns hex string from ArrayBuffer', () => {
      assert.strictEqual('a9993e364706816aba3e25717850c26c9cd0d89d', r.digestFromArrayBuffer(abcArrayBuffer));
    });
  });

  describe('rawDigest', () => {
    it('returns a sliced Int32Array', () => {
      assert.strictEqual(20, r.rawDigest(abcString).buffer.byteLength);
    });
    it('returns Int32Array from string', () => {
      assertBytesEqual(abcHashedInt32Array, r.rawDigest(abcString));
    });
    it('returns Int32Array from buffer', () => {
      assertBytesEqual(abcHashedInt32Array, r.rawDigest(abcBuffer));
    });
    it('returns Int32Array from array', () => {
      assertBytesEqual(abcHashedInt32Array, r.rawDigest(abcArray));
    });
    it('returns Int32Array from ArrayBuffer', () => {
      assertBytesEqual(abcHashedInt32Array, r.rawDigest(abcArrayBuffer));
    });
  });
});
