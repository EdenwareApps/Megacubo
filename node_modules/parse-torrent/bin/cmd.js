#!/usr/bin/env node

var stdin = require('get-stdin')
var parseTorrent = require('../')

function usage () {
  console.error('Usage: parse-torrent /path/to/torrent')
  console.error('       parse-torrent magnet_uri')
  console.error('       parse-torrent --stdin')
}

function error (err) {
  console.error(err.message)
  process.exit(1)
}

var arg = process.argv[2]

if (!arg) {
  console.error('Missing required argument')
  usage()
  process.exit(1)
}

if (arg === '--stdin' || arg === '-') stdin.buffer().then(onTorrentId)
else if (arg === '--version' || arg === '-v') console.log(require('../package.json').version)
else onTorrentId(arg)

function onTorrentId (torrentId) {
  parseTorrent.remote(torrentId, function (err, parsedTorrent) {
    if (err) return error(err)

    delete parsedTorrent.info
    delete parsedTorrent.infoBuffer
    delete parsedTorrent.infoHashBuffer
    console.log(JSON.stringify(parsedTorrent, undefined, 2))
  })
}
