var Socket = require('../')
var test = require('tape')

var SOCKET_SERVER = 'wss://echo.websocket.org'

test('echo string {objectMode: true}', function (t) {
  t.plan(4)

  var socket = new Socket(SOCKET_SERVER, {objectMode: true})
  socket.on('connect', function () {
    t.pass('connect emitted')
    socket.send('sup!')
    socket.on('data', function (data) {
      t.equal(typeof data, 'string', 'data is a string')
      t.equal(data, 'sup!')

      socket.destroy(function () {
        t.pass('destroyed socket')
      })
    })
  })
})

test('echo Buffer {objectMode: true}', function (t) {
  t.plan(4)

  var socket = new Socket(SOCKET_SERVER, {objectMode: true})
  socket.on('connect', function () {
    t.pass('connect emitted')
    socket.send(new Buffer([1, 2, 3]))
    socket.on('data', function (data) {
      t.ok(Buffer.isBuffer(data), 'data is Buffer')
      t.deepEqual(data, new Buffer([1, 2, 3]), 'got correct data')

      socket.destroy(function () {
        t.pass('destroyed socket')
      })
    })
  })
})

test('echo Uint8Array {objectMode: true}', function (t) {
  t.plan(4)

  var socket = new Socket(SOCKET_SERVER, {objectMode: true})
  socket.on('connect', function () {
    t.pass('connect emitted')
    socket.send(new Uint8Array([1, 2, 3]))
    socket.on('data', function (data) {
      // binary types always get converted to Buffer
      // See: https://github.com/feross/simple-peer/issues/138#issuecomment-278240571
      t.ok(Buffer.isBuffer(data), 'data is Buffer')
      t.deepEqual(data, new Buffer([1, 2, 3]), 'got correct data')

      socket.destroy(function () {
        t.pass('destroyed socket')
      })
    })
  })
})

test('echo ArrayBuffer {objectMode: true}', function (t) {
  t.plan(4)

  var socket = new Socket(SOCKET_SERVER, {objectMode: true})
  socket.on('connect', function () {
    t.pass('connect emitted')
    socket.send(new Uint8Array([1, 2, 3]).buffer)
    socket.on('data', function (data) {
      t.ok(Buffer.isBuffer(data), 'data is Buffer')
      t.deepEqual(data, new Buffer([1, 2, 3]), 'got correct data')

      socket.destroy(function () {
        t.pass('destroyed socket')
      })
    })
  })
})
