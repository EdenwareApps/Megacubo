"use strict";

var KBucket = require('../index.js');

var test = module.exports = {};

test['closest nodes are returned'] = function (test) {
    test.expect(3);
    var kBucket = new KBucket();
    kBucket.add({id: new Buffer('00', 'hex')}); // 00000000
    kBucket.add({id: new Buffer('01', 'hex')}); // 00000001
    kBucket.add({id: new Buffer('02', 'hex')}); // 00000010
    kBucket.add({id: new Buffer('03', 'hex')}); // 00000011
    kBucket.add({id: new Buffer('04', 'hex')}); // 00000100
    kBucket.add({id: new Buffer('05', 'hex')}); // 00000101
    kBucket.add({id: new Buffer('06', 'hex')}); // 00000110
    kBucket.add({id: new Buffer('07', 'hex')}); // 00000111
    kBucket.add({id: new Buffer('08', 'hex')}); // 00001000
    kBucket.add({id: new Buffer('09', 'hex')}); // 00001001
    kBucket.add({id: new Buffer('0a', 'hex')}); // 00001010
    kBucket.add({id: new Buffer('0b', 'hex')}); // 00001011
    kBucket.add({id: new Buffer('0c', 'hex')}); // 00001100
    kBucket.add({id: new Buffer('0d', 'hex')}); // 00001101
    kBucket.add({id: new Buffer('0e', 'hex')}); // 00001110
    kBucket.add({id: new Buffer('0f', 'hex')}); // 00001111
    kBucket.add({id: new Buffer('10', 'hex')}); // 00010000
    kBucket.add({id: new Buffer('11', 'hex')}); // 00010001
    var contact = {id: new Buffer('15', 'hex')};// 00010101
    var contacts = kBucket.closest(contact, 3);
    test.deepEqual(contacts[0].id, new Buffer('11', 'hex')); // distance: 00000100
    test.deepEqual(contacts[1].id, new Buffer('10', 'hex')); // distance: 00000101
    test.deepEqual(contacts[2].id, new Buffer('05', 'hex')); // distance: 00010000
    test.done();
};

test['closest nodes are returned (including exact match)'] = function (test) {
    test.expect(3);
    var kBucket = new KBucket();
    kBucket.add({id: new Buffer('00', 'hex')}); // 00000000
    kBucket.add({id: new Buffer('01', 'hex')}); // 00000001
    kBucket.add({id: new Buffer('02', 'hex')}); // 00000010
    kBucket.add({id: new Buffer('03', 'hex')}); // 00000011
    kBucket.add({id: new Buffer('04', 'hex')}); // 00000100
    kBucket.add({id: new Buffer('05', 'hex')}); // 00000101
    kBucket.add({id: new Buffer('06', 'hex')}); // 00000110
    kBucket.add({id: new Buffer('07', 'hex')}); // 00000111
    kBucket.add({id: new Buffer('08', 'hex')}); // 00001000
    kBucket.add({id: new Buffer('09', 'hex')}); // 00001001
    kBucket.add({id: new Buffer('0a', 'hex')}); // 00001010
    kBucket.add({id: new Buffer('0b', 'hex')}); // 00001011
    kBucket.add({id: new Buffer('0c', 'hex')}); // 00001100
    kBucket.add({id: new Buffer('0d', 'hex')}); // 00001101
    kBucket.add({id: new Buffer('0e', 'hex')}); // 00001110
    kBucket.add({id: new Buffer('0f', 'hex')}); // 00001111
    kBucket.add({id: new Buffer('10', 'hex')}); // 00010000
    kBucket.add({id: new Buffer('11', 'hex')}); // 00010001
    var contact = {id: new Buffer('11', 'hex')};// 00010001
    var contacts = kBucket.closest(contact, 3);
    test.deepEqual(contacts[0].id, new Buffer('11', 'hex')); // distance: 00000000
    test.deepEqual(contacts[1].id, new Buffer('10', 'hex')); // distance: 00000001
    test.deepEqual(contacts[2].id, new Buffer('01', 'hex')); // distance: 00010000
    test.done();
};

test['closest nodes are returned even if there isn\'t enough in one bucket'] = function (test) {
    test.expect(22);
    var i, iString;
    var kBucket = new KBucket({localNodeId: new Buffer('0000', 'hex')});
    for (i = 0; i < kBucket.numberOfNodesPerKBucket; i++) {
        iString = i.toString('16');
        if (iString.length < 2) {
            iString = '0' + iString;
        }
        var farString = '80' + iString; // make sure all go into "far away" bucket
        kBucket.add({id: new Buffer(farString, 'hex')});
        var nearString = '01' + iString;
        kBucket.add({id: new Buffer(nearString, 'hex')});
    }
    kBucket.add({id: new Buffer('0001', 'hex')});
    var contact = {id: new Buffer('0003', 'hex')}; // 0000000000000011
    var contacts = kBucket.closest(contact, 22);
    test.deepEqual(contacts[0].id, new Buffer('0001', 'hex')); // distance: 0000000000000010
    test.deepEqual(contacts[1].id, new Buffer('0103', 'hex')); // distance: 0000000100000000
    test.deepEqual(contacts[2].id, new Buffer('0102', 'hex')); // distance: 0000000100000010
    test.deepEqual(contacts[3].id, new Buffer('0101', 'hex'));
    test.deepEqual(contacts[4].id, new Buffer('0100', 'hex'));
    test.deepEqual(contacts[5].id, new Buffer('0107', 'hex'));
    test.deepEqual(contacts[6].id, new Buffer('0106', 'hex'));
    test.deepEqual(contacts[7].id, new Buffer('0105', 'hex'));
    test.deepEqual(contacts[8].id, new Buffer('0104', 'hex'));
    test.deepEqual(contacts[9].id, new Buffer('010b', 'hex'));
    test.deepEqual(contacts[10].id, new Buffer('010a', 'hex'));
    test.deepEqual(contacts[11].id, new Buffer('0109', 'hex'));
    test.deepEqual(contacts[12].id, new Buffer('0108', 'hex'));
    test.deepEqual(contacts[13].id, new Buffer('010f', 'hex'));
    test.deepEqual(contacts[14].id, new Buffer('010e', 'hex'));
    test.deepEqual(contacts[15].id, new Buffer('010d', 'hex'));
    test.deepEqual(contacts[16].id, new Buffer('010c', 'hex'));
    test.deepEqual(contacts[17].id, new Buffer('0113', 'hex'));
    test.deepEqual(contacts[18].id, new Buffer('0112', 'hex'));
    test.deepEqual(contacts[19].id, new Buffer('0111', 'hex'));
    test.deepEqual(contacts[20].id, new Buffer('0110', 'hex'));
    test.deepEqual(contacts[21].id, new Buffer('8003', 'hex')); // distance: 1000000000000000
    // console.log(require('util').inspect(kBucket, false, null));
    test.done();
};