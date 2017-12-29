"use strict";

var KBucket = require('../index.js');

var test = module.exports = {};

test['id 00000000, bitIndex 0, should be low'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    test.equal(kBucket.determineBucket(new Buffer("00", "hex"), 0), -1);
    test.done();
};

test['id 01000000, bitIndex 0, should be low'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    test.equal(kBucket.determineBucket(new Buffer("40", "hex"), 0), -1);
    test.done();
};

test['id 01000000, bitIndex 1, should be high'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    test.equal(kBucket.determineBucket(new Buffer("40", "hex"), 1), 1);
    test.done();
};

test['id 01000000, bitIndex 2, should be low'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    test.equal(kBucket.determineBucket(new Buffer("40", "hex"), 2), -1);
    test.done();
};

test['id 01000000, bitIndex 9, should be low'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    test.equal(kBucket.determineBucket(new Buffer("40", "hex"), 9), -1);
    test.done();
};

test['id 01000001, bitIndex 7, should be high'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    test.equal(kBucket.determineBucket(new Buffer("41", "hex"), 7), 1);
    test.done();
};

test['id 0100000100000000, bitIndex 7, should be high'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    test.equal(kBucket.determineBucket(new Buffer("4100", "hex"), 7), 1);
    test.done();
};

test['id 000000000100000100000000, bitIndex 15, should be high'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    test.equal(kBucket.determineBucket(new Buffer("004100", "hex"), 15), 1);
    test.done();
};