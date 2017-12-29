var fixtures = require('webtorrent-fixtures')
var parseTorrentFile = require('../')
var test = require('tape')

test('encode', function (t) {
  var parsedTorrent = parseTorrentFile(fixtures.leaves.torrent)
  var buf = parseTorrentFile.encode(parsedTorrent)
  var doubleParsedTorrent = parseTorrentFile(buf)

  t.deepEqual(doubleParsedTorrent, parsedTorrent)
  t.end()
})

test('encode w/ comment field', function (t) {
  var parsedTorrent = parseTorrentFile(fixtures.leaves.torrent)
  parsedTorrent.comment = 'hi there!'
  var buf = parseTorrentFile.encode(parsedTorrent)
  var doubleParsedTorrent = parseTorrentFile(buf)

  t.deepEqual(doubleParsedTorrent, parsedTorrent)
  t.end()
})
