"use strict";

var KBucket = require('../index.js');

var test = module.exports = {};

test['adding a contact does not split K-bucket'] = function (test) {
    test.expect(3);
    var kBucket = new KBucket();
    kBucket.add({id: new Buffer("a")});
    test.ok(!kBucket.low);
    test.ok(!kBucket.high);
    test.ok(kBucket.bucket);
    test.done();
};

test['adding maximum number of contacts (per K-bucket) [20]' +
     ' into K-bucket does not split K-bucket'] = function (test) {
    test.expect(3);
    var kBucket = new KBucket();
    for (var i = 0; i < kBucket.numberOfNodesPerKBucket; i++) {
        kBucket.add({id: new Buffer("" + i)});
    }
    test.ok(!kBucket.low);
    test.ok(!kBucket.high);
    test.ok(kBucket.bucket);
    test.done();
};

test['adding maximum number of contacts (per K-bucket) + 1 [21]' +
     ' into K-bucket splits the K-bucket'] = function (test) {
    test.expect(3);
    var kBucket = new KBucket();
    for (var i = 0; i < kBucket.numberOfNodesPerKBucket + 1; i++) {
        kBucket.add({id: new Buffer("" + i)});
    }
    test.ok(kBucket.low instanceof KBucket);
    test.ok(kBucket.high instanceof KBucket);
    test.ok(!kBucket.bucket);
    test.done();
};

test['split buckets inherit options from parent bucket'] = function (test) {
    var OPTIONS = ['arbiter', 'localNodeId', 'root', 'numberOfNodesPerKBucket',
                   'numberOfNodesToPing'];
    test.expect(2 * OPTIONS.length);
    var kBucket = new KBucket();
    var _options = {};
    OPTIONS.forEach(function(option){
        _options[option] = kBucket[option];
    });
    for (var i = 0; i < kBucket.numberOfNodesPerKBucket + 1; i++) {
        kBucket.add({id: new Buffer("" + i)});
    }
    OPTIONS.forEach(function(option){
        test.strictEqual(kBucket.low[option], _options[option]);
        test.strictEqual(kBucket.high[option], _options[option]);
    });
    test.done();
};

test['split buckets contain all added contacts'] = function (test) {
    test.expect(20 /*numberOfNodesPerKBucket*/ + 2);
    var kBucket = new KBucket({localNodeId: new Buffer('00', 'hex')});
    var foundContact = {};
    for (var i = 0; i < kBucket.numberOfNodesPerKBucket + 1; i++) {
        var iString = i.toString('16');
        if (iString.length < 2) {
            iString = '0' + iString;
        }
        kBucket.add({id: new Buffer(iString, 'hex')});
        foundContact[iString] = false;
    }
    var traverse = function (node) {
        if (!node.bucket) {
            traverse(node.low);
            traverse(node.high);
        } else {
            node.bucket.forEach(function (contact) {
                foundContact[contact.id.toString('hex')] = true;
            });
        }
    };
    traverse(kBucket);
    Object.keys(foundContact).forEach(function (key) {
        test.ok(foundContact[key], key);
    });
    test.ok(!kBucket.bucket);
    test.done();
};

test['when splitting buckets the "far away" bucket should be marked' +
     ' to prevent splitting "far away" bucket'] = function (test) {
    test.expect(5);
    var kBucket = new KBucket({localNodeId: new Buffer('00', 'hex')});
    for (var i = 0; i < kBucket.numberOfNodesPerKBucket + 1; i++) {
        var iString = i.toString('16');
        if (iString.length < 2) {
            iString = '0' + iString;
        }
        kBucket.add({id: new Buffer(iString, 'hex')});
    }
    // above algorithm will split low bucket 4 times and put 0x00 through 0x0f
    // in the low bucket, and put 0x10 through 0x14 in high bucket
    // since localNodeId is 0x00, we expect every high bucket to be "far" and
    // therefore marked as "dontSplit = true"
    // there will be one "low" bucket and four "high" buckets (test.expect(5))
    var traverse = function (node, dontSplit) {
        if (!node.bucket) {
            traverse(node.low, false);
            traverse(node.high, true);
        } else {
            if (dontSplit) {
                test.ok(node.dontSplit);
            } else {
                test.ok(!node.dontSplit);
            }
        }
    };
    traverse(kBucket);
    test.done();
};
