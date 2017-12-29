var Discovery = require('../')
var DHT = require('bittorrent-dht')
var hat = require('hat')
var test = require('tape')

test('re-use dht, verify that peers are filtered', function (t) {
  t.plan(3)
  var infoHash1 = new Buffer(hat(160), 'hex')
  var infoHash2 = new Buffer(hat(160), 'hex')

  var dht = new DHT()
  var discovery = new Discovery({
    peerId: hat(160),
    port: 6000,
    dht: dht
  })
  discovery.setTorrent(infoHash1)

  discovery.once('peer', function (addr) {
    t.equal(addr, '1.2.3.4:8000')
  })
  dht.emit('peer', { host: '1.2.3.4', port: '8000' }, infoHash1)

  // Only peers for `infoHash1` should get emitted, none from `infoHash2`
  discovery.once('peer', function (addr) {
    t.equal(addr, '4.5.6.7:8000')

    discovery.stop(function () {
      dht.destroy(function () {
        t.pass()
      })
    })
  })
  dht.emit('peer', { host: '2.3.4.5', port: '8000' }, infoHash2) // discovery should not emit this peer
  dht.emit('peer', { host: '3.4.5.6', port: '8000' }, infoHash2) // discovery should not emit this peer
  dht.emit('peer', { host: '4.5.6.7', port: '8000' }, infoHash1)
})
