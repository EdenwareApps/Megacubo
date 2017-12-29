'use strict'

var test = require('tape')
var http = require('http')
var https = require('https')
var pem = require('https-pem')
var enableDestroy = require('server-destroy')
var reverseHttp = require('./')

test('default values', function (t) {
  t.plan(4)

  var server = http.createServer(function (req, res) {
    t.fail('Unexpected HTTP request')
  })

  server.listen(function () {
    var n = 0
    var rserver = reverseHttp({ port: server.address().port }, function (req, res) {
      res.end()
      switch (++n) {
        case 1:
          t.equal(req.method, 'GET')
          t.equal(req.url, '/foo')
          break
        case 2:
          server.close()
          rserver.destroy()
          t.equal(req.method, 'GET')
          t.equal(req.url, '/bar')
          break
      }
    })

    rserver.on('error', function (err) {
      t.error(err)
    })
  })

  server.on('upgrade', function (req, socket, head) {
    socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
                 'Upgrade: PTTH/1.0\r\n' +
                 'Connection: Upgrade\r\n' +
                 '\r\n')

    socket.write('GET /foo HTTP/1.1\r\n\r\n')

    setTimeout(function () {
      socket.write('GET /bar HTTP/1.1\r\n\r\n')
    }, 50)
  })
})

test('reconnect', function (t) {
  t.plan(5)

  var n = 0
  var server = http.createServer(function (req, res) {
    t.fail('Unexpected HTTP request')
  })

  server.listen(function () {
    var rserver = reverseHttp({ port: server.address().port }, function (req, res) {
      res.end()

      t.equal(req.method, 'GET')
      t.equal(req.url, '/foo')

      if (n === 2) {
        server.close()
        rserver.destroy()
        t.ok(true)
      }
    })

    rserver.on('error', function (err) {
      t.error(err)
    })
  })

  server.on('upgrade', function (req, socket, head) {
    if (++n === 1) {
      setTimeout(function () {
        socket.destroy()
      }, 50)
    }

    socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
                 'Upgrade: PTTH/1.0\r\n' +
                 'Connection: Upgrade\r\n' +
                 '\r\n')

    socket.write('GET /foo HTTP/1.1\r\n\r\n')
  })
})

test('remote server goes offline', function (t) {
  t.plan(1)

  var server = http.createServer(function (req, res) {
    t.fail('Unexpected HTTP request')
  })

  enableDestroy(server)

  server.listen(function () {
    var rserver = reverseHttp({ port: server.address().port })
    rserver.on('error', function (err) {
      t.equal(err.code, 'ECONNREFUSED')
    })
  })

  server.on('upgrade', function (req, socket, head) {
    socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
                 'Upgrade: PTTH/1.0\r\n' +
                 'Connection: Upgrade\r\n' +
                 '\r\n')

    setTimeout(function () {
      server.destroy()
    }, 50)
  })
})

test('respond', function (t) {
  t.plan(1)

  var server = http.createServer(function (req, res) {
    t.fail('Unexpected HTTP request')
  })
  var rserver

  server.listen(function () {
    rserver = reverseHttp({ port: server.address().port }, function (req, res) {
      res.writeHead(418)
      res.write('foo')
      res.end()
    })
  })

  server.on('upgrade', function (req, socket, head) {
    socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
                 'Upgrade: PTTH/1.0\r\n' +
                 'Connection: Upgrade\r\n' +
                 '\r\n')

    setTimeout(function () {
      socket.write('GET /foo HTTP/1.1\r\n\r\n')
    }, 50)

    socket.once('data', function (chunk) {
      var lines = chunk.toString().split('\r\n')
      t.equal(lines[0], 'HTTP/1.1 418 I\'m a teapot')
      server.close()
      rserver.destroy()
    })
  })
})

test('https', function (t) {
  t.plan(4)

  var server = https.createServer(pem, function (req, res) {
    t.fail('Unexpected HTTP request')
  })

  server.listen(function () {
    var n = 0
    var rserver = reverseHttp({ port: server.address().port, tls: true, rejectUnauthorized: false }, function (req, res) {
      res.end()
      switch (++n) {
        case 1:
          t.equal(req.method, 'GET')
          t.equal(req.url, '/foo')
          break
        case 2:
          server.close()
          rserver.destroy()
          t.equal(req.method, 'GET')
          t.equal(req.url, '/bar')
          break
      }
    })

    rserver.on('error', function (err) {
      t.error(err)
    })
  })

  server.on('upgrade', function (req, socket, head) {
    socket.write('HTTPS/1.1 101 Switching Protocols\r\n' +
                 'Upgrade: PTTH/1.0\r\n' +
                 'Connection: Upgrade\r\n' +
                 '\r\n')

    socket.write('GET /foo HTTP/1.1\r\n\r\n')

    setTimeout(function () {
      socket.write('GET /bar HTTP/1.1\r\n\r\n')
    }, 50)
  })
})
