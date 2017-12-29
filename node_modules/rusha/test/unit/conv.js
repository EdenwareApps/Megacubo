'use strict';

const conv = require('../../src/conv');

describe('binary string conversion', () => {
  it('converts a full string with a zero offset', () => {
    const buf = new ArrayBuffer(16);
    conv('foobarbazquux42', new Int8Array(buf), new Int32Array(buf), 0, 15, 0);
    expect(Array.from(new Uint8Array(buf))).to.deep.equal(
      [98, 111, 111, 102, 97, 98, 114, 97, 117, 117, 113, 122, 0, 50, 52, 120]
    );
  });

  it('converts a string in chunks of one byte', () => {
    const buf = new ArrayBuffer(16);
    conv('f', new Int8Array(buf), new Int32Array(buf), 0, 1, 0);
    conv('o', new Int8Array(buf), new Int32Array(buf), 0, 1, 1);
    conv('o', new Int8Array(buf), new Int32Array(buf), 0, 1, 2);
    conv('b', new Int8Array(buf), new Int32Array(buf), 0, 1, 3);
    conv('a', new Int8Array(buf), new Int32Array(buf), 0, 1, 4);
    conv('r', new Int8Array(buf), new Int32Array(buf), 0, 1, 5);
    conv('b', new Int8Array(buf), new Int32Array(buf), 0, 1, 6);
    conv('a', new Int8Array(buf), new Int32Array(buf), 0, 1, 7);
    conv('z', new Int8Array(buf), new Int32Array(buf), 0, 1, 8);
    conv('q', new Int8Array(buf), new Int32Array(buf), 0, 1, 9);
    conv('u', new Int8Array(buf), new Int32Array(buf), 0, 1, 10);
    conv('u', new Int8Array(buf), new Int32Array(buf), 0, 1, 11);
    conv('x', new Int8Array(buf), new Int32Array(buf), 0, 1, 12);
    conv('4', new Int8Array(buf), new Int32Array(buf), 0, 1, 13);
    conv('2', new Int8Array(buf), new Int32Array(buf), 0, 1, 14);
    expect(Array.from(new Uint8Array(buf))).to.deep.equal(
      [98, 111, 111, 102, 97, 98, 114, 97, 117, 117, 113, 122, 0, 50, 52, 120]
    );
  });

  it('converts a string in chunks of two bytes', () => {
    const buf = new ArrayBuffer(16);
    conv('fo', new Int8Array(buf), new Int32Array(buf), 0, 2, 0);
    conv('ob', new Int8Array(buf), new Int32Array(buf), 0, 2, 2);
    conv('ar', new Int8Array(buf), new Int32Array(buf), 0, 2, 4);
    conv('ba', new Int8Array(buf), new Int32Array(buf), 0, 2, 6);
    conv('zq', new Int8Array(buf), new Int32Array(buf), 0, 2, 8);
    conv('uu', new Int8Array(buf), new Int32Array(buf), 0, 2, 10);
    conv('x4', new Int8Array(buf), new Int32Array(buf), 0, 2, 12);
    conv('2', new Int8Array(buf), new Int32Array(buf), 0, 1, 14);
    expect(Array.from(new Uint8Array(buf))).to.deep.equal(
      [98, 111, 111, 102, 97, 98, 114, 97, 117, 117, 113, 122, 0, 50, 52, 120]
    );
  });

  it('converts a string in chunks of three bytes', () => {
    const buf = new ArrayBuffer(16);
    conv('foo', new Int8Array(buf), new Int32Array(buf), 0, 3, 0);
    conv('bar', new Int8Array(buf), new Int32Array(buf), 0, 3, 3);
    conv('baz', new Int8Array(buf), new Int32Array(buf), 0, 3, 6);
    conv('quu', new Int8Array(buf), new Int32Array(buf), 0, 3, 9);
    conv('x42', new Int8Array(buf), new Int32Array(buf), 0, 3, 12);
    expect(Array.from(new Uint8Array(buf))).to.deep.equal(
      [98, 111, 111, 102, 97, 98, 114, 97, 117, 117, 113, 122, 0, 50, 52, 120]
    );
  });

  it('converts a string in chunks of five bytes', () => {
    const buf = new ArrayBuffer(16);
    conv('fooba', new Int8Array(buf), new Int32Array(buf), 0, 5, 0);
    conv('rbazq', new Int8Array(buf), new Int32Array(buf), 0, 5, 5);
    conv('uux42', new Int8Array(buf), new Int32Array(buf), 0, 5, 10);
    expect(Array.from(new Uint8Array(buf))).to.deep.equal(
      [98, 111, 111, 102, 97, 98, 114, 97, 117, 117, 113, 122, 0, 50, 52, 120]
    );
  });

  it('converts a string in chunks of seven bytes', () => {
    const buf = new ArrayBuffer(16);
    conv('foobarb', new Int8Array(buf), new Int32Array(buf), 0, 7, 0);
    conv('azquux4', new Int8Array(buf), new Int32Array(buf), 0, 7, 7);
    conv('2', new Int8Array(buf), new Int32Array(buf), 0, 1, 14);
    expect(Array.from(new Uint8Array(buf))).to.deep.equal(
      [98, 111, 111, 102, 97, 98, 114, 97, 117, 117, 113, 122, 0, 50, 52, 120]
    );
  });

  it('converts a string in chunks of eleven bytes', () => {
    const buf = new ArrayBuffer(16);
    conv('foobarbazqu', new Int8Array(buf), new Int32Array(buf), 0, 11, 0);
    conv('ux42', new Int8Array(buf), new Int32Array(buf), 0, 4, 11);
    expect(Array.from(new Uint8Array(buf))).to.deep.equal(
      [98, 111, 111, 102, 97, 98, 114, 97, 117, 117, 113, 122, 0, 50, 52, 120]
    );
  });
});

describe('Array conversion', () => {
  it('converts a full array with a zero offset', () => {
    const buf = new ArrayBuffer(16);
    const arr = [102, 111, 111, 98, 97, 114, 98, 97, 122, 113, 117, 117, 120, 52, 50];
    conv(arr, new Int8Array(buf), new Int32Array(buf), 0, 15, 0);
    expect(Array.from(new Uint8Array(buf))).to.deep.equal(
      [98, 111, 111, 102, 97, 98, 114, 97, 117, 117, 113, 122, 0, 50, 52, 120]
    );
  });
});

describe('ArrayBuffer conversion', () => {
  it('converts a full array with a zero offset', () => {
    const buf = new ArrayBuffer(16);
    const arr = Uint8Array.from([102, 111, 111, 98, 97, 114, 98, 97, 122, 113, 117, 117, 120, 52, 50]);
    conv(arr.buffer, new Int8Array(buf), new Int32Array(buf), 0, 15, 0);
    expect(Array.from(new Uint8Array(buf))).to.deep.equal(
      [98, 111, 111, 102, 97, 98, 114, 97, 117, 117, 113, 122, 0, 50, 52, 120]
    );
  });
});

describe('TypedArray conversion', () => {
  it('converts a full array with a zero offset', () => {
    const buf = new ArrayBuffer(16);
    const arr = Uint8Array.from([102, 111, 111, 98, 97, 114, 98, 97, 122, 113, 117, 117, 120, 52, 50]);
    conv(arr, new Int8Array(buf), new Int32Array(buf), 0, 15, 0);
    expect(Array.from(new Uint8Array(buf))).to.deep.equal(
      [98, 111, 111, 102, 97, 98, 114, 97, 117, 117, 113, 122, 0, 50, 52, 120]
    );
  }); 
});
