'use strict';

const assert = require('assert');

const Rusha = require('../dist/rusha');
const {toHex} = require('../src/utils');

const generateRandomChunks = (count) => {
  const lengths = [];
  for (let i = 0; i < count; i++) {
    lengths.push(Math.ceil(Math.random() * 65536));
  }
  const buffer = new ArrayBuffer(lengths.reduce((x, y) => x + y, 0));
  const chunks = [];
  lengths.reduce((off, len) => {
    const data = new Uint8Array(buffer, off, len);
    window.crypto.getRandomValues(data);
    chunks.push(data);
    return off + len;
  }, 0);
  return {chunks, buffer};
};

describe('fuzzing using random Uint8Array', () => {
  for (let i = 0; i < 100; i++) {
    it(`chunk count = ${i}`, () => {
      const {chunks, buffer} = generateRandomChunks(i);
      const hash = Rusha.createHash();
      for (const chunk of chunks) {
        hash.update(chunk);
      }
      const digest = hash.digest('hex');

      return crypto.subtle.digest('SHA-1', buffer).then(referenceDigest => {
        assert.strictEqual(digest, toHex(referenceDigest));
      });
    });
  }
});
