"use strict";

var bufferEqual = require('buffer-equal');
var events = require('events');

var KBucket = require('../index.js');

var test = module.exports = {};

test['localNodeId should be a random SHA-1 if not provided'] = function (test) {
    test.expect(2);
    var kBucket = new KBucket();
    test.ok(kBucket.localNodeId instanceof Buffer);
    test.equal(kBucket.localNodeId.length, 20); // SHA-1 is 160 bits (20 bytes)
    test.done();
};

test['localNodeId is a Buffer populated from options if options.localNodeId Buffer is provided'] = function (test) {
    var localNodeId = new Buffer("some length");
    test.expect(2);
    var kBucket = new KBucket({localNodeId: localNodeId});
    test.ok(kBucket.localNodeId instanceof Buffer);
    test.ok(bufferEqual(kBucket.localNodeId, localNodeId));
    test.done();
};

test['throws exception if options.localNodeId is a String'] = function (test) {
    var localNodeId = "some identifier";
    test.expect(1);
    test.throws(function() {
        new KBucket({localNodeId: "some identifier"});
    }, Error);
    test.done();
};

test['root is \'self\' if not provided'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    test.strictEqual(kBucket.root, kBucket);
    test.done();
};

test['inherits from EventEmitter'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    test.ok(kBucket instanceof events.EventEmitter);
    test.done();
};
