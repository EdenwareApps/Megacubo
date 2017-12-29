var abstractTests = require('abstract-chunk-store/tests')
var ImmediateChunkStore = require('./')
var FSChunkStore = require('fs-chunk-store')
var MemoryChunkStore = require('memory-chunk-store')
var test = require('tape')

abstractTests(test, function (chunkLength) {
  return new ImmediateChunkStore(new MemoryChunkStore(chunkLength))
})

abstractTests(test, function (chunkLength) {
  return new ImmediateChunkStore(new FSChunkStore(chunkLength))
})

test('put then immediate get', function (t) {
  var store = new ImmediateChunkStore(new FSChunkStore(10))

  store.put(0, new Buffer('0123456789'), onPut)

  // And now, get the same chunk out BEFORE the put is complete
  store.get(0, function (err, data) {
    t.error(err)
    t.deepEqual(data, new Buffer('0123456789'))
    didGet1 = true
    maybeDone()
  })

  function onPut (err) {
    t.error(err)

    // Getting after put should still work
    store.get(0, function (err, data) {
      t.error(err)
      t.deepEqual(data, new Buffer('0123456789'))
      didGet2 = true
      maybeDone()
    })
  }

  var didGet1 = false
  var didGet2 = false
  function maybeDone () {
    if (didGet1 && didGet2) {
      store.destroy(function (err) {
        t.error(err)
        t.end()
      })
    }
  }
})
