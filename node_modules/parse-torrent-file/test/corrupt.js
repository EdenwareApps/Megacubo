var fixtures = require('webtorrent-fixtures')
var parseTorrentFile = require('../')
var test = require('tape')

test('exception thrown when torrent file is missing `name` field', function (t) {
  t.throws(function () {
    parseTorrentFile(fixtures.corrupt.torrent)
  })
  t.end()
})
