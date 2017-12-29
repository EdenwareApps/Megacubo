# immediate-chunk-store [![travis][travis-image]][travis-url] [![npm][npm-image]][npm-url] [![downloads][downloads-image]][downloads-url]

[travis-image]: https://img.shields.io/travis/feross/immediate-chunk-store/master.svg
[travis-url]: https://travis-ci.org/feross/immediate-chunk-store
[npm-image]: https://img.shields.io/npm/v/immediate-chunk-store.svg
[npm-url]: https://npmjs.org/package/immediate-chunk-store
[downloads-image]: https://img.shields.io/npm/dm/immediate-chunk-store.svg
[downloads-url]: https://npmjs.org/package/immediate-chunk-store

#### Immediate put/get for [abstract-chunk-store](https://github.com/mafintosh/abstract-chunk-store) compliant stores

Makes `store.put()` chunks immediately available for `store.get()`, even before the
`store.put()` callback is called. Data is stored in memory until the `store.put()`
is complete.

## Install

```
npm install immediate-chunk-store
```

## Usage

``` js
var ImmediateChunkStore = require('immediate-chunk-store')
var FSChunkStore = require('fs-chunk-store') // any chunk store will work

var store = new ImmediateChunkStore(new FSChunkStore(10))

store.put(0, new Buffer('abc'), function () { /* yolo */ })

// And now, get the same chunk out BEFORE the put is complete
store.get(0, function (err, data) {
  if (err) throw err
  console.log(data.toString()) // 'abc'
})
```

## License

MIT. Copyright (c) [Feross Aboukhadijeh](http://feross.org).
