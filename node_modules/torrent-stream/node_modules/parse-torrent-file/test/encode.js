var fs = require('fs')
var parseTorrent = require('../')
var test = require('tape')

var leaves = fs.readFileSync(__dirname + '/torrents/leaves.torrent')

test('encode', function (t) {
  var parsedTorrent = parseTorrent(leaves)
  var buf = parseTorrent.encode(parsedTorrent)
  var doubleParsedTorrent = parseTorrent(buf)

  t.deepEqual(parsedTorrent.infoBuffer, doubleParsedTorrent.infoBuffer)
  t.equal(parsedTorrent.created.getDate(), doubleParsedTorrent.created.getDate())
  t.deepEqual(parsedTorrent.announce, doubleParsedTorrent.announce)
  t.deepEqual(parsedTorrent.announceList, doubleParsedTorrent.announceList)

  t.end()
})
