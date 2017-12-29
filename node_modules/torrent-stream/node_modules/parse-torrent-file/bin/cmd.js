#!/usr/bin/env node

var fs = require('fs')
var parseTorrent = require('../')

function usage () {
  console.error('Usage: parse-torrent-file /path/to/torrent')
}

var torrentPath = process.argv[2]

if (!torrentPath) {
  usage()
  process.exit(-1)
}

try {
  var parsedTorrent = parseTorrent(fs.readFileSync(torrentPath))
} catch (err) {
  console.error(err.message + '\n')
  usage()
  process.exit(-1)
}

delete parsedTorrent.info
delete parsedTorrent.infoBuffer

console.log(JSON.stringify(parsedTorrent, undefined, 2))
