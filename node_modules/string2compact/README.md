# string2compact
[![build](https://img.shields.io/travis/feross/string2compact.svg?style=flat)](https://travis-ci.org/feross/string2compact)
[![npm](https://img.shields.io/npm/v/string2compact.svg?style=flat)](https://npmjs.org/package/string2compact)
[![npm downloads](https://img.shields.io/npm/dm/string2compact.svg?style=flat)](https://npmjs.org/package/string2compact)
[![gittip](https://img.shields.io/gittip/feross.svg?style=flat)](https://www.gittip.com/feross/)

#### Convert 'hostname:port' strings to BitTorrent's compact ip/host binary returned by Trackers

[![Sauce Test Status](https://saucelabs.com/browser-matrix/string2compact.svg)](https://saucelabs.com/u/string2compact)

This module is the opposite of [compact2string](https://npmjs.org/package/compact2string). It works in the browser with [browserify](http://browserify.org/). It is used by [WebTorrent](http://webtorrent.io), and more specifically, the [bittorrent-tracker](https://github.com/feross/bittorrent-tracker) and [bittorrent-dht](https://github.com/feross/bittorrent-dht) modules.

### install

```
npm install string2compact
```

### usage

#### single string2compact

```js
var string2compact = require('string2compact')
var compact = string2compact('10.10.10.5:65408')
console.log(compact) // new Buffer('0A0A0A05FF80', 'hex')
```

#### tranform multiple into one buffer

```js
var compacts = string2compact([ '10.10.10.5:128', '100.56.58.99:28525' ])
console.log(compacts) // new Buffer('0A0A0A05008064383a636f6d', 'hex')
```

### license

MIT. Copyright (c) [Feross Aboukhadijeh](http://feross.org).
