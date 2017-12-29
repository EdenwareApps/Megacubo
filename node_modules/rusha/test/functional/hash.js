'use strict';

const assert = require('assert');

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
  const hash = Rusha.createHash();
  for (let i = 0, len = (input.byteLength || input.length); i < len; i++) {
    hash.update(input.slice(i, i + 1));
  }
  return hash.digest('hex');
};

const abcString = 'abc';
let abcBuffer;
const abcArray = [97, 98, 99];
const abcArrayBuffer = new Int8Array(abcArray).buffer;

if (typeof Buffer === 'function') {
  abcBuffer = new Buffer('abc', 'ascii');
} else {
  abcBuffer = new Int8Array(abcArray);
}

const abcHashedBuffer = new Int8Array([0xA9, 0x99, 0x3E, 0x36, 0x47, 0x06, 0x81, 0x6A, 0xBA, 0x3E, 0x25, 0x71, 0x78, 0x50, 0xC2, 0x6C, 0x9C, 0xD0, 0xD8, 0x9D]).buffer;

describe('Hash', () => {
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

  describe('hex digest', () => {
    it('returns hex string from string', () => {
      const digest = Rusha.createHash().update(abcString).digest('hex');
      assert.strictEqual('a9993e364706816aba3e25717850c26c9cd0d89d', digest);
    });
    it('returns hex string from buffer', () => {
      const digest = Rusha.createHash().update(abcBuffer).digest('hex');
      assert.strictEqual('a9993e364706816aba3e25717850c26c9cd0d89d', digest);
    });
    it('returns hex string from array', () => {
      const digest = Rusha.createHash().update(abcArray).digest('hex');
      assert.strictEqual('a9993e364706816aba3e25717850c26c9cd0d89d', digest);
    });
    it('returns hex string from ArrayBuffer', () => {
      const digest = Rusha.createHash().update(abcArrayBuffer).digest('hex');
      assert.strictEqual('a9993e364706816aba3e25717850c26c9cd0d89d', digest);
    });
  });

  describe('raw digest', () => {
    it('returns an ArrayBuffer', () => {
      const digest = Rusha.createHash().update(abcString).digest();
      assert(digest instanceof ArrayBuffer);
      assert.strictEqual(20, digest.byteLength);
    });
    it('returns ArrayBuffer from string', () => {
      const digest = Rusha.createHash().update(abcString).digest();
      assert(digest instanceof ArrayBuffer);
      assertBytesEqual(abcHashedBuffer, digest);
    });
    it('returns ArrayBuffer from buffer', () => {
      const digest = Rusha.createHash().update(abcBuffer).digest();
      assert(digest instanceof ArrayBuffer);
      assertBytesEqual(abcHashedBuffer, digest);
    });
    it('returns ArrayBuffer from array', () => {
      const digest = Rusha.createHash().update(abcArray).digest();
      assert(digest instanceof ArrayBuffer);
      assertBytesEqual(abcHashedBuffer, digest);
    });
    it('returns ArrayBuffer from ArrayBuffer', () => {
      const digest = Rusha.createHash().update(abcArrayBuffer).digest();
      assert(digest instanceof ArrayBuffer);
      assertBytesEqual(abcHashedBuffer, digest);
    });
  });
});
