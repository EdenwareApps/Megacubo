"use strict";

var KBucket = require('../index.js'),
    bufferEqual = require('buffer-equal');

var test = module.exports = {};

test['invalid index results in exception'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    var contact = {id: new Buffer("a")};
    kBucket.add(contact);
    try {
        kBucket.update(contact, 1);
    } catch (exception) {
        test.ok(true);
    }
    test.done();
};

test['deprecated vectorClock results in contact drop'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    var contact = {id: new Buffer("a"), vectorClock: 3};
    kBucket.add(contact);
    kBucket.update({id: new Buffer("a"), vectorClock: 2}, 0);
    test.equal(kBucket.bucket[0].vectorClock, 3);
    test.done();
};

test['equal vectorClock results in contact marked as most recent'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    var contact = {id: new Buffer("a"), vectorClock: 3};
    kBucket.add(contact);
    kBucket.add({id: new Buffer("b")});
    kBucket.update(contact, 0);
    test.equal(kBucket.bucket[1], contact);
    test.done();
};

test['more recent vectorClock results in contact update and contact being' +
     ' marked as most recent'] = function (test) {
    test.expect(4);
    var kBucket = new KBucket();
    var contact = {id: new Buffer("a"), old: 'property', vectorClock: 3};
    kBucket.add(contact);
    kBucket.add({id: new Buffer("b")});
    kBucket.update({id: new Buffer("a"), newer: 'property', vectorClock: 4}, 0);
    test.ok(bufferEqual(kBucket.bucket[1].id, contact.id));
    test.equal(kBucket.bucket[1].vectorClock, 4);
    test.strictEqual(kBucket.bucket[1].old, undefined);
    test.strictEqual(kBucket.bucket[1].newer, 'property');
    test.done();
};