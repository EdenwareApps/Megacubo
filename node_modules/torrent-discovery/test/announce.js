var Discovery = require('../')
var DHT = require('bittorrent-dht')
var hat = require('hat')
var test = require('tape')

test('initialize with dht', function (t) {
  t.plan(5)
  var dht = new DHT({ bootstrap: false })
  var discovery = new Discovery({
    peerId: hat(160),
    port: 6000,
    dht: dht,
    intervalMs: 1000
  })
  discovery.setTorrent(hat(160))

  var _dhtAnnounce = discovery._dhtAnnounce
  var num = 0
  discovery._dhtAnnounce = function () {
    num += 1
    t.pass('called once after 1000ms')
    _dhtAnnounce.call(discovery)
    if (num === 4) {
      discovery.stop(function () {
        dht.destroy(function () {
          t.pass()
        })
      })
    }
  }
})
