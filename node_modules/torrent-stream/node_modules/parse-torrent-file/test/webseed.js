var fs = require('fs')
var parseTorrent = require('../')
var test = require('tape')

var leavesUrlList = fs.readFileSync(__dirname + '/torrents/leaves-url-list.torrent')

test('parse url-list for webseed support', function (t) {
  var torrent = parseTorrent(leavesUrlList)
  t.deepEqual(torrent.urlList, [ 'http://www2.hn.psu.edu/faculty/jmanis/whitman/leaves-of-grass6x9.pdf' ])
  t.end()
})
