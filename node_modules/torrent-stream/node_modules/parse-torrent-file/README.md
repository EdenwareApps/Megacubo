# parse-torrent-file
[![travis](https://img.shields.io/travis/feross/parse-torrent-file.svg?style=flat)](https://travis-ci.org/feross/parse-torrent-file)
[![npm](https://img.shields.io/npm/v/parse-torrent-file.svg?style=flat)](https://npmjs.org/package/parse-torrent-file)
[![downloads](https://img.shields.io/npm/dm/parse-torrent-file.svg?style=flat)](https://npmjs.org/package/parse-torrent-file)

#### Parse a .torrent file and return an object of keys/values

[![Sauce Test Status](https://saucelabs.com/browser-matrix/parse-torrent-file.svg)](https://saucelabs.com/u/parse-torrent-file)

Works in node and the browser (with [browserify](http://browserify.org/)). This module is
used by [WebTorrent](http://webtorrent.io)!

## install

```
npm install parse-torrent-file
```

## usage

```js
var parseTorrentFile = require('parse-torrent-file')

var torrent = fs.readFileSync(__dirname + '/torrents/leaves.torrent')
var parsed
try {
  parsed = parseTorrentFile(torrent)
} catch (e) {
  // the torrent file was corrupt
  console.error(e)
}

console.log(parsed.name) // Prints "Leaves of Grass by Walt Whitman.epub"
```

The `parsed` torrent object looks like this:

```js
{
  "infoHash": "d2474e86c95b19b8bcfdb92bc12c9d44667cfa36",
  "name": "Leaves of Grass by Walt Whitman.epub",
  "private": false,
  "created": "2013-08-01T13:27:46.000Z",
  "announceList": [
    [
      "http://tracker.thepiratebay.org/announce"
    ],
    [
      "udp://tracker.openbittorrent.com:80"
    ],
    [
      "udp://tracker.ccc.de:80"
    ],
    [
      "udp://tracker.publicbt.com:80"
    ],
    [
      "udp://fr33domtracker.h33t.com:3310/announce",
      "http://tracker.bittorrent.am/announce"
    ]
  ],
  "announce": [
    "http://tracker.thepiratebay.org/announce",
    "udp://tracker.openbittorrent.com:80",
    "udp://tracker.ccc.de:80",
    "udp://tracker.publicbt.com:80",
    "udp://fr33domtracker.h33t.com:3310/announce",
    "http://tracker.bittorrent.am/announce"
  ],
  "urlList": [],
  "files": [
    {
      "path": "Leaves of Grass by Walt Whitman.epub",
      "name": "Leaves of Grass by Walt Whitman.epub",
      "length": 362017,
      "offset": 0
    }
  ],
  "length": 362017,
  "pieceLength": 16384,
  "lastPieceLength": 1569,
  "pieces": [
    "1f9c3f59beec079715ec53324bde8569e4a0b4eb",
    "ec42307d4ce5557b5d3964c5ef55d354cf4a6ecc",
    "7bf1bcaf79d11fa5e0be06593c8faafc0c2ba2cf",
    "76d71c5b01526b23007f9e9929beafc5151e6511",
    "0931a1b44c21bf1e68b9138f90495e690dbc55f5",
    "72e4c2944cbacf26e6b3ae8a7229d88aafa05f61",
    "eaae6abf3f07cb6db9677cc6aded4dd3985e4586",
    "27567fa7639f065f71b18954304aca6366729e0b",
    "4773d77ae80caa96a524804dfe4b9bd3deaef999",
    "c9dd51027467519d5eb2561ae2cc01467de5f643",
    "0a60bcba24797692efa8770d23df0a830d91cb35",
    "b3407a88baa0590dc8c9aa6a120f274367dcd867",
    "e88e8338c572a06e3c801b29f519df532b3e76f6",
    "70cf6aee53107f3d39378483f69cf80fa568b1ea",
    "c53b506159e988d8bc16922d125d77d803d652c3",
    "ca3070c16eed9172ab506d20e522ea3f1ab674b3",
    "f923d76fe8f44ff32e372c3b376564c6fb5f0dbe",
    "52164f03629fd1322636babb2c014b7dae582da4",
    "1363965261e6ce12b43701f0a8c9ed1520a70eba",
    "004400a267765f6d3dd5c7beb5bd3c75f3df2a54",
    "560a61801147fa4ec7cf568e703acb04e5610a4d",
    "56dcc242d03293e9446cf5e457d8eb3d9588fd90",
    "c698de9b0dad92980906c026d8c1408fa08fe4ec"
  ]
}
```

To convert a parsed torrent back into a .torrent file buffer, call `parseTorrentFile.encode`.

```js
var parseTorrentFile = require('parse-torrent-file')

// parse a torrent
var parsed = parseTorrentFile(/* some buffer */)

// convert parsed torrent back to a buffer
var buf = parseTorrentFile.encode(parsed)
```

## credit

This was originally based on [read-torrent](https://www.npmjs.org/package/read-torrent) by [mafintosh](https://twitter.com/mafintosh). It's basically a pared-down version of that, but it works in the browser (so [WebTorrent](http://webtorrent.io) can use it), doesn't have huge npm dependencies like `request` (saving on file size), and it has tests. Thanks for publishing good modules, mafintosh!

## license

MIT. Copyright (c) [Feross Aboukhadijeh](http://feross.org).
