"use strict";

var KBucket = require('../index.js');

var test = module.exports = {};

test['distance between 00000000 and 00000000 is 00000000'] = function (test) {
    test.expect(1);
    test.equal(
        KBucket.distance(new Buffer('00', 'hex'), new Buffer('00', 'hex')),
        0);
    test.done();
};

test['distance between 00000000 and 00000001 is 00000001'] = function (test) {
    test.expect(1);
    test.equal(
        KBucket.distance(new Buffer('00', 'hex'), new Buffer('01', 'hex')),
        1);
    test.done();
};

test['distance between 00000010 and 00000001 is 00000011'] = function (test) {
    test.expect(1);
    test.equal(
        KBucket.distance(new Buffer('02', 'hex'), new Buffer('01', 'hex')),
        3);
    test.done();
};

test['distance between 00000000 and 0000000000000000 is 0000000011111111'] = function (test) {
    test.expect(1);
    test.equal(
        KBucket.distance(new Buffer('00', 'hex'), new Buffer('0000', 'hex')),
        255);
    test.done();
};

test['distance between 0000000100100100 and 0100000000100100 is 0100000100000000'] = function (test) {
    test.expect(1);
    test.equal(
        KBucket.distance(new Buffer('0124', 'hex'), new Buffer('4024', 'hex')),
        16640);
    test.done();
};