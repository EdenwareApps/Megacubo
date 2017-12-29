"use strict";

var bufferEqual = require('buffer-equal');
var KBucket = require('../index.js');

var test = module.exports = {};

test['get retrieves null if no contacts'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    test.strictEqual(null, kBucket.get(new Buffer('foo')));
    test.done();
};

test['get retrieves a contact that was added'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    var contact = {id: new Buffer("a")};
    kBucket.add(contact);
    test.ok(bufferEqual(kBucket.get(new Buffer("a")).id, new Buffer("a")));
    test.done();
};

test['get retrieves most recently added contact if same id'] = function (test) {
    test.expect(3);
    var kBucket = new KBucket();
    var contact = {id: new Buffer("a"), foo: 'foo', bar: ':p', vectorClock: 0};
    var contact2 = {id: new Buffer("a"), foo: 'bar', vectorClock: 1};
    kBucket.add(contact);
    kBucket.add(contact2);
    test.ok(bufferEqual(kBucket.get(new Buffer("a")).id, new Buffer("a")));
    test.equal(kBucket.get(new Buffer("a")).foo, 'bar');
    test.strictEqual(kBucket.get(new Buffer("a")).bar, undefined);
    test.done();
};

test['get retrieves contact from nested leaf node'] = function (test) {
    test.expect(1);
    var iString;
    var kBucket = new KBucket({localNodeId: new Buffer('0000', 'hex')});
    for (var i = 0; i < kBucket.numberOfNodesPerKBucket; i++) {
        iString = i.toString('16');
        if (iString.length < 2) {
            iString = '0' + iString;
        }
        iString = '80' + iString; // make sure all go into "far away" bucket
        kBucket.add({id: new Buffer(iString, 'hex')});
    }
    // cause a split to happen
    kBucket.add({id: new Buffer('00' + iString, 'hex'), find: 'me'});
    test.equal(kBucket.get(new Buffer('00' + iString, 'hex')).find, 'me');
    test.done();
};