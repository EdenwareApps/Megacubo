var fs = require('fs')
var parseTorrentFile = require('../')
var path = require('path')
var test = require('tape')

var leavesUrlList = fs.readFileSync(path.join(__dirname, 'torrents/leaves-url-list.torrent'))

test('parse url-list for webseed support', function (t) {
  var torrent = parseTorrentFile(leavesUrlList)
  t.deepEqual(torrent.urlList, [ 'http://www2.hn.psu.edu/faculty/jmanis/whitman/leaves-of-grass6x9.pdf' ])
  t.end()
})

test('encode url-list for webseed support', function (t) {
  var parsedTorrent = parseTorrentFile(leavesUrlList)
  var buf = parseTorrentFile.encode(parsedTorrent)
  var doubleParsedTorrent = parseTorrentFile(buf)
  t.deepEqual(doubleParsedTorrent.urlList, [ 'http://www2.hn.psu.edu/faculty/jmanis/whitman/leaves-of-grass6x9.pdf' ])
  t.end()
})
