var fs = require('fs')
var parseTorrent = require('../')
var test = require('tape')

var leaves = fs.readFileSync(__dirname + '/torrents/leaves.torrent')
var leavesParsed = parseTorrent(leaves)

test('Test supported torrentInfo types', function (t) {
  var parsed

  // info hash (as a hex string)
  parsed = parseTorrent(leavesParsed.infoHash)
  t.equal(parsed.infoHash, leavesParsed.infoHash)
  t.equal(parsed.name, undefined)
  t.deepEqual(parsed.announce, [])

  // info hash (as a Buffer)
  parsed = parseTorrent(new Buffer(leavesParsed.infoHash, 'hex'))
  t.equal(parsed.infoHash, leavesParsed.infoHash)
  t.equal(parsed.name, undefined)
  t.deepEqual(parsed.announce, [])

  // magnet uri (as a utf8 string)
  var magnet = 'magnet:?xt=urn:btih:' + leavesParsed.infoHash
  parsed = parseTorrent(magnet)
  t.equal(parsed.infoHash, leavesParsed.infoHash)
  t.equal(parsed.name, undefined)
  t.deepEqual(parsed.announce, [])

  // magnet uri with name
  parsed = parseTorrent(magnet + '&dn=' + encodeURIComponent(leavesParsed.name))
  t.equal(parsed.infoHash, leavesParsed.infoHash)
  t.equal(parsed.name, leavesParsed.name)
  t.deepEqual(parsed.announce, [])

  // magnet uri with trackers
  parsed = parseTorrent(magnet + '&tr=' + encodeURIComponent(leavesParsed.announce[0]))
  t.equal(parsed.infoHash, leavesParsed.infoHash)
  t.equal(parsed.name, undefined)
  t.deepEqual(parsed.announce, [ leavesParsed.announce[0] ])

  // .torrent file (as a Buffer)
  parsed = parseTorrent(leaves)
  t.equal(parsed.infoHash, leavesParsed.infoHash)
  t.equal(parsed.name, leavesParsed.name)
  t.deepEqual(parsed.announce, leavesParsed.announce)

  // leavesParsed torrent (as an Object)
  parsed = parseTorrent(leavesParsed)
  t.equal(parsed.infoHash, leavesParsed.infoHash)
  t.equal(parsed.name, leavesParsed.name)
  t.deepEqual(parsed.announce, leavesParsed.announce)

  t.end()
})
