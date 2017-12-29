var allocUnsafe = require('./')
var assert = require('assert')

var b1 = allocUnsafe(4)
assert.equal(b1.length, 4)
assert.ok(Buffer.isBuffer(b1))

var b2 = allocUnsafe(6)
assert.equal(b2.length, 6)
assert.ok(Buffer.isBuffer(b2))

var b3 = allocUnsafe(10)
assert.equal(b3.length, 10)
assert.ok(Buffer.isBuffer(b3))
