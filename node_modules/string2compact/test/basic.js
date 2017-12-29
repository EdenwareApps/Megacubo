var compact2string = require('compact2string')
var test = require('tape')

var string2compact = require('../')

test('single', function (t) {
  var compact = string2compact('10.10.10.5:65408')
  t.deepEqual(compact, new Buffer('0A0A0A05FF80', 'hex'))
  t.end()
})

test('single IPv6', function (t) {
  var compact = string2compact('[2a03:2880:2110:9f07:face:b00c::1]:80')
  t.deepEqual(compact, new Buffer('2a03288021109f07faceb00c000000010050', 'hex'))
  t.end()
})

test('multi', function (t) {
  // For this test, we assume that the compact2string implementation is good and just run
  // the conversion in reverse and see if we get the same thing back
  var ips = [ '127.0.0.1:6881', '127.0.0.1:6882' ]
  t.deepEqual(compact2string.multi(string2compact(ips)), ips)
  t.end()
})

test('multi IPv6', function (t) {
  // For this test, we assume that the compact2string implementation is good and just run
  // the conversion in reverse and see if we get the same thing back
  var ips = [ '[2a03:2880:2110:9f07:face:b00c::1]:80', '[2a00:1450:4008:801::1011]:443' ]
  t.deepEqual(compact2string.multi6(string2compact(ips)), ips)
  t.end()
})

test('multi (byte check)', function (t) {
  var compacts = string2compact([ '10.10.10.5:128', '100.56.58.99:28525' ])
  t.deepEqual(compacts, new Buffer('0A0A0A05008064383a636f6d', 'hex'))
  t.end()
})
