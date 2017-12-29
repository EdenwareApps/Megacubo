'use strict'

var test = require('tape')
var net = require('net')
var http = require('http')
var consumeHead = require('./')

test('request', function (t) {
  t.plan(7)

  var server = net.createServer(function (socket) {
    consumeHead(socket, function (err, head) {
      t.error(err)
      t.equal(head.method, 'GET')
      t.equal(head.url, '/')
      t.deepEqual(head.version, { major: 1, minor: 1 })

      if (head.headers['connection'] === 'close') {
        t.deepEqual(head.headers, {
          connection: 'close',
          host: 'localhost:' + server.address().port,
          'x-foo': 'bar'
        })
      } else {
        t.deepEqual(head.headers, {
          connection: 'keep-alive',
          host: 'localhost:' + server.address().port,
          'x-foo': 'bar'
        })
      }

      socket.on('data', function (chunk) {
        t.equal(chunk.toString(), 'Hello World')
        socket.end('HTTP/1.1 200 OK\r\n\r\n')
      })
    })
  })

  server.listen(function () {
    var port = server.address().port
    var req = http.request({ port: port, headers: { 'X-Foo': 'bar' } }, function (res) {
      server.close()
      t.equal(res.statusCode, 200)
    })
    req.write('Hello World')
  })
})

test('response', function (t) {
  var server = http.createServer(function (req, res) {
    res.setHeader('X-Foo', 'bar')
    res.end('Hello World')
  })

  server.listen(function () {
    var port = server.address().port
    var socket = net.connect({ port: port })
    socket.write('GET / HTTP/1.1\r\n\r\n')

    consumeHead(socket, function (err, head) {
      t.error(err)
      t.deepEqual(head.version, { major: 1, minor: 1 })
      t.equal(head.statusCode, 200)
      t.equal(head.statusMessage, 'OK')

      var chunked = head.headers['transfer-encoding'] === 'chunked'

      if (chunked) {
        t.deepEqual(head.headers, {
          connection: 'keep-alive',
          date: head.headers.date,
          'transfer-encoding': 'chunked',
          'x-foo': 'bar'
        })
      } else {
        t.deepEqual(head.headers, {
          connection: 'keep-alive',
          'content-length': '11',
          date: head.headers.date,
          'x-foo': 'bar'
        })
      }

      socket.on('data', function (chunk) {
        if (chunked) {
          t.equal(chunk.toString(), 'b\r\nHello World\r\n0\r\n\r\n')
        } else {
          t.equal(chunk.toString(), 'Hello World')
        }
        socket.end()
        server.close()
        t.end()
      })
    })
  })
})
