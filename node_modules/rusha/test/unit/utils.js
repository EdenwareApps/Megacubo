'use strict';

const assert = require('assert');

const utils = require('../../src/utils');

describe('toHex', () => {
  it('converts an array buffer full of zeroes', () => {
    assert.strictEqual('0000000000000000', utils.toHex(new ArrayBuffer(8)));
  });

  it('converts an array buffer of mixed digits', () => {
    const buf = new ArrayBuffer(8);
    const view = new Int8Array(buf);
    view[0] = 0;
    view[1] = 255;
    view[2] = 127;
    view[3] = 126;
    view[4] = 52;
    view[5] = 200;
    view[6] = 178;
    view[7] = 15;
    assert.strictEqual('00ff7f7e34c8b20f', utils.toHex(buf));
  });
});

describe('ceilHeapSize', () => {
  it('rounds up to 2^16', () => {
    assert.strictEqual(65536, utils.ceilHeapSize(0));
    assert.strictEqual(65536, utils.ceilHeapSize(255));
    assert.strictEqual(65536, utils.ceilHeapSize(65535));
    assert.strictEqual(65536, utils.ceilHeapSize(65536));
  });

  it('rounds up to 2^n while n < 24', () => {
    assert.strictEqual(131072, utils.ceilHeapSize(65537));
    assert.strictEqual(131072, utils.ceilHeapSize(131000));
    assert.strictEqual(131072, utils.ceilHeapSize(131072));
    assert.strictEqual(262144, utils.ceilHeapSize(131073));
    assert.strictEqual(262144, utils.ceilHeapSize(262144));
    assert.strictEqual(524288, utils.ceilHeapSize(262145));
    assert.strictEqual(524288, utils.ceilHeapSize(524288));
    assert.strictEqual(1048576, utils.ceilHeapSize(524289));
    assert.strictEqual(1048576, utils.ceilHeapSize(1048576));
    assert.strictEqual(2097152, utils.ceilHeapSize(1048577));
    assert.strictEqual(2097152, utils.ceilHeapSize(2097152));
    assert.strictEqual(4194304, utils.ceilHeapSize(2097153));
    assert.strictEqual(4194304, utils.ceilHeapSize(4194304));
    assert.strictEqual(8388608, utils.ceilHeapSize(4194305));
    assert.strictEqual(8388608, utils.ceilHeapSize(8388608));
  });

  it('otherwise rounds up to 2^24 * n', () => {
    assert.strictEqual(16777216, utils.ceilHeapSize(8388609));
    assert.strictEqual(16777216, utils.ceilHeapSize(16777216));
    assert.strictEqual(33554432, utils.ceilHeapSize(16777217));
  });
});
