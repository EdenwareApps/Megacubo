#!/usr/bin/env node

var fs = require('fs')
var parseTorrent = require('../')

function usage () {
  console.error('Usage: parse-torrent /path/to/torrent')
  console.error('       parse-torrent magnet_uri')
}

function error (err) {
  if (err) console.error(err.message)
  usage()
}

var torrentId = process.argv[2]

if (!torrentId) {
  usage()
  process.exit(1)
}

var parsedTorrent
try {
  parsedTorrent = parseTorrent(torrentId)
} catch (err1) {
  var file
  try {
    file = fs.readFileSync(torrentId)
  } catch (err2) {
    error(err1)
    process.exit(1)
  }
  try {
    parsedTorrent = parseTorrent(file)
  } catch (err2) {
    error(err2)
    process.exit(1)
  }
}

delete parsedTorrent.info
delete parsedTorrent.infoBuffer

console.log(JSON.stringify(parsedTorrent, undefined, 2))
