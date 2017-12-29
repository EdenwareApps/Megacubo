# magnet-uri [![travis][travis-image]][travis-url] [![npm][npm-image]][npm-url] [![downloads][downloads-image]][downloads-url]

[travis-image]: https://img.shields.io/travis/feross/magnet-uri.svg?style=flat
[travis-url]: https://travis-ci.org/feross/magnet-uri
[npm-image]: https://img.shields.io/npm/v/magnet-uri.svg?style=flat
[npm-url]: https://npmjs.org/package/magnet-uri
[downloads-image]: https://img.shields.io/npm/dm/magnet-uri.svg?style=flat
[downloads-url]: https://npmjs.org/package/magnet-uri

### Parse a magnet URI and return an object of keys/values.

[![Sauce Test Status](https://saucelabs.com/browser-matrix/magnet-uri.svg)](https://saucelabs.com/u/magnet-uri)

Also works in the browser with [browserify](http://browserify.org/)! This module is used by [WebTorrent](http://webtorrent.io).

## install

```
npm install magnet-uri
```

## usage

### decode

Parse a magnet URI and return an object of keys/values.

```js
var magnet = require('magnet-uri')

// "Leaves of Grass" by Walt Whitman
var uri = 'magnet:?xt=urn:btih:d2474e86c95b19b8bcfdb92bc12c9d44667cfa36&dn=Leaves+of+Grass+by+Walt+Whitman.epub&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80&tr=udp%3A%2F%2Ftracker.publicbt.com%3A80&tr=udp%3A%2F%2Ftracker.istole.it%3A6969&tr=udp%3A%2F%2Ftracker.ccc.de%3A80&tr=udp%3A%2F%2Fopen.demonii.com%3A1337'

var parsed = magnet.decode(uri)
console.log(parsed.dn) // "Leaves of Grass by Walt Whitman.epub"
console.log(parsed.infoHash) // "d2474e86c95b19b8bcfdb92bc12c9d44667cfa36"

```

The `parsed` magnet link object looks like this:

```js
  {
    "xt": "urn:btih:d2474e86c95b19b8bcfdb92bc12c9d44667cfa36",
    "dn": "Leaves of Grass by Walt Whitman.epub",
    "tr": [
      "udp://tracker.openbittorrent.com:80",
      "udp://tracker.publicbt.com:80",
      "udp://tracker.istole.it:6969",
      "udp://tracker.ccc.de:80",
      "udp://open.demonii.com:1337"
    ],

    // added for convenience:
    "infoHash": "d2474e86c95b19b8bcfdb92bc12c9d44667cfa36",
    "name": "Leaves of Grass by Walt Whitman.epub",
    "announce": [
      "udp://tracker.openbittorrent.com:80",
      "udp://tracker.publicbt.com:80",
      "udp://tracker.istole.it:6969",
      "udp://tracker.ccc.de:80",
      "udp://open.demonii.com:1337"
    ]
  }
```

### encode

Convert an object of key/values into a magnet URI string.

```js
var magnet = require('magnet-uri')

var uri = magnet.encode({
  xt: [
    'urn:ed2k:354B15E68FB8F36D7CD88FF94116CDC1',
    'urn:tree:tiger:7N5OAMRNGMSSEUE3ORHOKWN4WWIQ5X4EBOOTLJY',
    'urn:btih:QHQXPYWMACKDWKP47RRVIV7VOURXFE5Q'
  ],
  xl: '10826029',
  dn: 'mediawiki-1.15.1.tar.gz',
  tr: [
    'udp://tracker.openbittorrent.com:80/announce'
  ],
  as: 'http://download.wikimedia.org/mediawiki/1.15/mediawiki-1.15.1.tar.gz',
  xs: [
    'http://cache.example.org/XRX2PEFXOOEJFRVUCX6HMZMKS5TWG4K5',
    'dchub://example.org'
  ]
})

console.log(uri) // the magnet uri
```

The returned magnet uri will be:

```
magnet:?xt=urn:ed2k:354B15E68FB8F36D7CD88FF94116CDC1&xt=urn:tree:tiger:7N5OAMRNGMSSEUE3ORHOKWN4WWIQ5X4EBOOTLJY&xt=urn:btih:QHQXPYWMACKDWKP47RRVIV7VOURXFE5Q&xl=10826029&dn=mediawiki-1.15.1.tar.gz&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80%2Fannounce&as=http%3A%2F%2Fdownload.wikimedia.org%2Fmediawiki%2F1.15%2Fmediawiki-1.15.1.tar.gz&xs=http%3A%2F%2Fcache.example.org%2FXRX2PEFXOOEJFRVUCX6HMZMKS5TWG4K5&xs=dchub%3A%2F%2Fexample.org
```

You can also use convenience key names like `name` (`dn`), `infoHash` (`xt`),
`announce` (`tr`), `announceList` (`tr`), and `keywords` (`kt`).

## license

MIT. Copyright (c) [Feross Aboukhadijeh](http://feross.org).
