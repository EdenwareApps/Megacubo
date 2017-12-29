var Piece = require('../')
var test = require('tape')

function makeChunk (value, length) {
  var buf = Buffer.alloc(length || Piece.BLOCK_LENGTH)
  buf.fill(value)
  return buf
}

test('initial state', function (t) {
  var length = Piece.BLOCK_LENGTH * 4
  var piece = new Piece(length)

  t.equal(piece.length, length)
  t.equal(piece.missing, length)

  t.equal(piece.chunkLength(0), Piece.BLOCK_LENGTH)
  t.equal(piece.chunkLength(1), Piece.BLOCK_LENGTH)
  t.equal(piece.chunkLength(2), Piece.BLOCK_LENGTH)
  t.equal(piece.chunkLength(3), Piece.BLOCK_LENGTH)

  t.equal(piece.chunkOffset(0), 0)
  t.equal(piece.chunkOffset(1), 1 * Piece.BLOCK_LENGTH)
  t.equal(piece.chunkOffset(2), 2 * Piece.BLOCK_LENGTH)
  t.equal(piece.chunkOffset(3), 3 * Piece.BLOCK_LENGTH)

  t.notOk(piece.get(0))
  t.notOk(piece.get(1))
  t.notOk(piece.get(2))
  t.notOk(piece.get(3))

  t.end()
})

test('initial state - last chunk is different size', function (t) {
  var length = (Piece.BLOCK_LENGTH * 3) + 999
  var piece = new Piece(length)

  t.equal(piece.length, length)
  t.equal(piece.missing, length)

  t.equal(piece.chunkLength(0), Piece.BLOCK_LENGTH)
  t.equal(piece.chunkLength(1), Piece.BLOCK_LENGTH)
  t.equal(piece.chunkLength(2), Piece.BLOCK_LENGTH)
  t.equal(piece.chunkLength(3), 999)

  t.equal(piece.chunkOffset(0), 0)
  t.equal(piece.chunkOffset(1), 1 * Piece.BLOCK_LENGTH)
  t.equal(piece.chunkOffset(2), 2 * Piece.BLOCK_LENGTH)
  t.equal(piece.chunkOffset(3), 3 * Piece.BLOCK_LENGTH)

  t.notOk(piece.get(0))
  t.notOk(piece.get(1))
  t.notOk(piece.get(2))
  t.notOk(piece.get(3))

  t.end()
})

test('basic usage', function (t) {
  var length = Piece.BLOCK_LENGTH * 4
  var piece = new Piece(length)

  t.notOk(piece.get(0))
  t.equal(piece.reserve(), 0)
  piece.set(0, makeChunk('first chunk'))
  t.deepEqual(piece.get(0), makeChunk('first chunk'))

  t.notOk(piece.get(1))
  t.equal(piece.reserve(), 1)
  piece.set(1, makeChunk('second chunk'))
  t.deepEqual(piece.get(1), makeChunk('second chunk'))

  t.notOk(piece.get(2))
  t.equal(piece.reserve(), 2)
  piece.set(2, makeChunk('third chunk'))
  t.deepEqual(piece.get(2), makeChunk('third chunk'))

  t.notOk(piece.get(3))
  piece.set(3, makeChunk('fourth chunk'))
  t.equal(piece.reserve(), 3)
  t.deepEqual(piece.get(3), makeChunk('fourth chunk'))

  t.equal(piece.reserve(), -1)

  var completeBuf = Buffer.concat([
    makeChunk('first chunk'),
    makeChunk('second chunk'),
    makeChunk('third chunk'),
    makeChunk('fourth chunk')
  ])
  var flushedBuf = piece.flush()
  t.deepEqual(flushedBuf, completeBuf)
  t.equal(flushedBuf.length, Piece.BLOCK_LENGTH * 4)

  t.end()
})

test('basic usage - last chunk is different size', function (t) {
  var length = (Piece.BLOCK_LENGTH * 3) + 999
  var piece = new Piece(length)

  t.notOk(piece.get(0))
  t.equal(piece.reserve(), 0)
  piece.set(0, makeChunk('first chunk'))
  t.deepEqual(piece.get(0), makeChunk('first chunk'))

  t.notOk(piece.get(1))
  t.equal(piece.reserve(), 1)
  piece.set(1, makeChunk('second chunk'))
  t.deepEqual(piece.get(1), makeChunk('second chunk'))

  t.notOk(piece.get(2))
  t.equal(piece.reserve(), 2)
  piece.set(2, makeChunk('third chunk'))
  t.deepEqual(piece.get(2), makeChunk('third chunk'))

  t.notOk(piece.get(3))
  piece.set(3, makeChunk('fourth chunk', 999))
  t.equal(piece.reserve(), 3)
  t.deepEqual(piece.get(3), makeChunk('fourth chunk', 999))

  t.equal(piece.reserve(), -1)

  var completeBuf = Buffer.concat([
    makeChunk('first chunk'),
    makeChunk('second chunk'),
    makeChunk('third chunk'),
    makeChunk('fourth chunk', 999)
  ])
  var flushedBuf = piece.flush()
  t.deepEqual(flushedBuf, completeBuf)
  t.equal(flushedBuf.length, (Piece.BLOCK_LENGTH * 3) + 999)

  t.end()
})

test('cancel', function (t) {
  var length = Piece.BLOCK_LENGTH * 4
  var piece = new Piece(length)

  t.equal(piece.reserve(), 0)
  t.equal(piece.reserve(), 1)
  piece.cancel(0)
  t.equal(piece.reserve(), 0)
  piece.cancel(0)
  t.equal(piece.reserve(), 0)
  piece.cancel(1)
  t.equal(piece.reserve(), 1)
  t.equal(piece.reserve(), 2)
  t.equal(piece.reserve(), 3)
  piece.cancel(3)
  t.equal(piece.reserve(), 3)
  t.equal(piece.reserve(), -1)
  t.equal(piece.reserve(), -1)
  t.equal(piece.reserve(), -1)

  t.end()
})
