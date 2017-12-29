"use strict";

var KBucket = require('../index.js');

var test = module.exports = {};

test['removing a contact should remove contact from nested buckets'] = function (test) {
    test.expect(2);
    var kBucket = new KBucket({localNodeId: new Buffer('0000', 'hex')});
    for (var i = 0; i < kBucket.numberOfNodesPerKBucket; i++) {
        var iString = i.toString('16');
        if (iString.length < 2) {
            iString = '0' + iString;
        }
        iString = '80' + iString; // make sure all go into "far away" bucket
        kBucket.add({id: new Buffer(iString, 'hex')});
    }
    // cause a split to happen
    kBucket.add({id: new Buffer('00' + iString, 'hex')});
    // console.log(require('util').inspect(kBucket, false, null));
    var contactToDelete = {id: new Buffer('8000', 'hex')};
    test.equal(kBucket.high.indexOf(contactToDelete), 0);
    kBucket.remove({id: new Buffer('8000', 'hex')});
    test.equal(kBucket.high.indexOf(contactToDelete), -1);
    test.done();
};