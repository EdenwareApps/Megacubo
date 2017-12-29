"use strict";

var KBucket = require('../index.js');

var test = module.exports = {};

test['count returns 0 when no contacts in bucket'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    test.equal(kBucket.count(), 0);
    test.done();
};

test['count returns 1 when 1 contact in bucket'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    var contact = {id: new Buffer("a")};
    kBucket.add(contact);
    test.equal(kBucket.count(), 1);
    test.done();
};

test['count returns 1 when same contact added to bucket twice'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    var contact = {id: new Buffer("a")};
    kBucket.add(contact);
    kBucket.add(contact);
    test.equal(kBucket.count(), 1);
    test.done();
};

test['count returns number of added unique contacts'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    kBucket.add({id: new Buffer("a")});
    kBucket.add({id: new Buffer("a")});
    kBucket.add({id: new Buffer("b")});
    kBucket.add({id: new Buffer("b")});
    kBucket.add({id: new Buffer("c")});
    kBucket.add({id: new Buffer("d")});
    kBucket.add({id: new Buffer("c")});
    kBucket.add({id: new Buffer("d")});
    kBucket.add({id: new Buffer("e")});
    kBucket.add({id: new Buffer("f")});
    test.equal(kBucket.count(), 6);
    test.done();
};