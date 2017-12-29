"use strict";

var KBucket = require('../index.js');

var test = module.exports = {};

test['indexOf returns a contact with id that contains the same byte sequence' +
     ' as the test contact'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    kBucket.add({id: new Buffer("a")});
    test.equal(kBucket.indexOf({id: new Buffer("a")}), 0);
    test.done();
};

test['indexOf returns -1 if contact is not found'] = function (test) {
    test.expect(1);
    var kBucket = new KBucket();
    kBucket.add({id: new Buffer("a")});
    test.equal(kBucket.indexOf({id: new Buffer("b")}), -1);
    test.done();
};