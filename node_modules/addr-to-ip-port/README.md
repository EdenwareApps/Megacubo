# addr-to-ip-port [![travis](https://img.shields.io/travis/feross/addr-to-ip-port.svg)](https://travis-ci.org/feross/addr-to-ip-port) [![npm](https://img.shields.io/npm/v/addr-to-ip-port.svg)](https://npmjs.org/package/addr-to-ip-port) [![downloads](https://img.shields.io/npm/dm/addr-to-ip-port.svg)](https://npmjs.org/package/addr-to-ip-port)

#### Convert an "address:port" string to an array [address:string, port:number]

[![browser support](https://ci.testling.com/feross/addr-to-ip-port.png)](https://ci.testling.com/feross/addr-to-ip-port)

Uses a cache to prevent excessive array allocations and GC.

Works in node and the browser. This module is used by [WebTorrent](http://webtorrent.io)!

### install

```
npm install addr-to-ip-port
```

### usage

```js
var addrToIPPort = require('addr-to-ip-port')

addrToIPPort('1.2.3.4:8000') //=> ['1.2.3.4', 8000]
addrToIPPort('1.2.3.4:8000') //=> ['1.2.3.4', 8000] (returns the cached object)
```

### license

MIT. Copyright (c) [Feross Aboukhadijeh](http://feross.org).
