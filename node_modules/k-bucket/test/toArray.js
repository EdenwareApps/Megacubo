"use strict";

var KBucket = require('../index.js');

var test = module.exports = {};

test['toArray should return empty array if no contacts'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    test.equal(kBucket.toArray().length, 0);
    test.done();
};

test['toArray should return all contacts in an array arranged from low to high buckets'] = function (test) {
    test.expect(22);
    var iString;
    var expectedIds = [];
    var kBucket = new KBucket({localNodeId: new Buffer('0000', 'hex')});
    for (var i = 0; i < kBucket.numberOfNodesPerKBucket; i++) {
        iString = i.toString('16');
        if (iString.length < 2) {
            iString = '0' + iString;
        }
        iString = '80' + iString; // make sure all go into "far away" bucket
        expectedIds.push(iString);
        kBucket.add({id: new Buffer(iString, 'hex')});
    }
    // cause a split to happen
    kBucket.add({id: new Buffer('00' + iString, 'hex')});
    // console.log(require('util').inspect(kBucket, {depth: null}));
    var contacts = kBucket.toArray();
    // console.log(require('util').inspect(contacts, {depth: null}));
    test.equal(contacts.length, kBucket.numberOfNodesPerKBucket + 1);
    test.equal(contacts[0].id.toString('hex'), '00' + iString);
    contacts.shift(); // get rid of low bucket contact
    for (i = 0; i < kBucket.numberOfNodesPerKBucket; i++) {
        test.equal(contacts[i].id.toString('hex'), expectedIds[i]);
    }
    test.done();
};