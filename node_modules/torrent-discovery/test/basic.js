var Discovery = require('../')
var DHT = require('bittorrent-dht')
var hat = require('hat')
var test = require('tape')

test('initialize with dht', function (t) {
  t.plan(1)
  var dht = new DHT()
  var discovery = new Discovery({
    peerId: hat(160),
    port: 6000,
    dht: dht
  })
  discovery.stop(function () {
    dht.destroy(function () {
      t.pass()
    })
  })
})

test('initialize with default dht', function (t) {
  t.plan(1)
  var discovery = new Discovery({
    peerId: hat(160),
    port: 6000
  })
  discovery.stop(function () {
    t.pass()
  })
})

test('initialize without dht', function (t) {
  t.plan(2)
  var discovery = new Discovery({
    peerId: hat(160),
    port: 6000,
    dht: false
  })
  t.equal(discovery.dht, false)
  discovery.stop(function () {
    t.pass()
  })
})
