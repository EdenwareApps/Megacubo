"use strict";

var KBucket = require('../index.js');

var test = module.exports = {};

test['adding a contact places it in bucket'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    var contact = {id: new Buffer("a")};
    kBucket.add(contact);
    test.ok(kBucket.bucket[0] === contact);
    test.done();
};

test['adding an existing contact does not increase number of contacts in ' +
     'bucket' ] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    var contact = {id: new Buffer("a")};
    kBucket.add(contact);
    kBucket.add({id: new Buffer("a")});
    test.equal(kBucket.bucket.length, 1);
    test.done();
};

test['adding same contact moves it to the end of the bucket ' +
     '(most-recently-contacted end)'] = function (test) {
    test.expect(5);
    var kBucket = new KBucket();
    var contact = {id: new Buffer("a")};
    kBucket.add(contact);
    test.equal(kBucket.bucket.length, 1);
    kBucket.add({id: new Buffer("b")});
    test.equal(kBucket.bucket.length, 2);
    test.equal(kBucket.bucket[0], contact); // least-recently-contacted end
    kBucket.add(contact);
    test.equal(kBucket.bucket.length, 2);
    test.equal(kBucket.bucket[1], contact); // most-recently-contacted end
    test.done();
};

test['adding contact to bucket that can\'t be split results in emitting' +
     ' "ping" event'] = function (test) {
    var i, iString, j;
    test.expect(3 /*numberOfNodesToPing*/ + 2);
    var kBucket = new KBucket({localNodeId: new Buffer('0000', 'hex')});
    kBucket.on('ping', function (contacts, replacement) {
        test.equal(contacts.length, kBucket.numberOfNodesToPing);
        // console.dir(kBucket.high.bucket[0]);
        for (var i = 0; i < kBucket.numberOfNodesToPing; i++) {
            // the least recently contacted end of the bucket should be pinged
            test.equal(contacts[i], kBucket.high.bucket[i]);
        }
        test.deepEqual(replacement, {id: new Buffer(iString, 'hex')})
        test.done();
    });
    for (var j = 0; j < kBucket.numberOfNodesPerKBucket + 1; j++) {
        iString = j.toString('16');
        if (iString.length < 2) {
            iString = '0' + iString;
        }
        iString = '80' + iString; // make sure all go into "far away" bucket
        kBucket.add({id: new Buffer(iString, 'hex')});
    }
};