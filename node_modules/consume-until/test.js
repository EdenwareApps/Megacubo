'use strict'

var test = require('tape')
var PassThrough = require('stream').PassThrough
var consumeUntil = require('./')

test('string', function (t) {
  var s = new PassThrough()

  s.write('foo')

  consumeUntil(s, 'b', function (err, buf) {
    t.error(err)
    t.equal(buf.toString(), 'foo')
    s.write('baz')
    s.once('data', function (chunk) {
      t.equal(chunk.toString(), 'bar')
      s.once('data', function (chunk) {
        t.equal(chunk.toString(), 'baz')
        t.end()
      })
    })
  })

  process.nextTick(function () {
    s.write('bar')
  })
})

test('buffer', function (t) {
  var s = new PassThrough()

  s.write('foobar')

  consumeUntil(s, new Buffer('bar'), function (err, buf) {
    t.error(err)
    t.equal(buf.toString(), 'foo')
    s.once('data', function (chunk) {
      t.equal(chunk.toString(), 'bar')
      t.end()
    })
  })
})

test('end', function (t) {
  var s = new PassThrough()

  s.end('foobar')

  consumeUntil(s, new Buffer('baz'), function (err, buf) {
    t.equal(err.message, 'Stream did not contain pattern')
    t.notOk(buf)
    t.end()
  })
})

test('error', function (t) {
  var s = new PassThrough()

  consumeUntil(s, 'bar', function (err, buf) {
    t.equal(err.message, 'fail')
    t.notOk(buf)
    t.end()
  })

  s.emit('error', new Error('fail'))
  s.end('foobar')
})
