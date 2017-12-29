'use strict'

var test = require('tape')
var http = require('http')
var bplist = require('bplist-parser')
var AirPlay = require('./')

test('setup reverse HTTP', function (t) {
  t.plan(1)

  var server = http.createServer(function (req, res) {
    t.fail('unexpected HTTP request')
  })

  server.on('upgrade', onUpgrade)

  server.listen(function () {
    var airplay = new AirPlay('localhost', server.address().port)

    airplay._startReverse()

    airplay.on('event', function (event) {
      server.close()
      airplay.destroy()
      t.deepEqual(event, { category: 'video', sessionID: 13, state: 'paused' })
    })
  })
})

test('airplay.state', function (t) {
  var server = http.createServer()

  server.on('upgrade', onUpgrade)

  server.listen(function () {
    var airplay = new AirPlay('localhost', server.address().port)

    airplay._startReverse()

    t.equal(airplay.state, undefined)

    airplay.on('event', function (event) {
      server.close()
      airplay.destroy()
      t.equal(airplay.state, event.state)
      t.end()
    })
  })
})

test('serverInfo', function (t) {
  var server = http.createServer(function (req, res) {
    t.equal(req.method, 'GET')
    t.equal(req.url, '/server-info')
    res.end()
  })

  server.on('upgrade', onUpgrade)

  server.listen(function () {
    var airplay = new AirPlay('localhost', server.address().port)

    airplay.serverInfo(function (err, res, body) {
      server.close()
      airplay.destroy()
      t.error(err)
      t.equal(res.statusCode, 200)
      t.deepEqual(body, Buffer(0))
      t.end()
    })
  })
})

test('play', function (t) {
  var server = http.createServer(function (req, res) {
    t.equal(req.method, 'POST')
    t.equal(req.url, '/play')
    req.on('data', function (chunk) {
      t.equal(chunk.toString(), 'Content-Location: foo\nStart-Position: 0\n')
      res.end()
    })
  })

  server.on('upgrade', onUpgrade)

  server.listen(function () {
    var airplay = new AirPlay('localhost', server.address().port)

    airplay.play('foo', function (err, res, body) {
      server.close()
      airplay.destroy()
      t.error(err)
      t.equal(res.statusCode, 200)
      t.deepEqual(body, Buffer(0))
      t.end()
    })
  })
})

test('play', function (t) {
  var server = http.createServer(function (req, res) {
    t.equal(req.method, 'POST')
    t.equal(req.url, '/play')
    req.on('data', function (chunk) {
      t.equal(chunk.toString(), 'Content-Location: foo\nStart-Position: 0.42\n')
      res.end()
    })
  })

  server.on('upgrade', onUpgrade)

  server.listen(function () {
    var airplay = new AirPlay('localhost', server.address().port)

    airplay.play('foo', 0.42, function (err, res, body) {
      server.close()
      airplay.destroy()
      t.error(err)
      t.equal(res.statusCode, 200)
      t.deepEqual(body, Buffer(0))
      t.end()
    })
  })
})

test('get scrub', function (t) {
  var server = http.createServer(function (req, res) {
    t.equal(req.method, 'GET')
    t.equal(req.url, '/scrub')
    res.end()
  })

  server.on('upgrade', onUpgrade)

  server.listen(function () {
    var airplay = new AirPlay('localhost', server.address().port)

    airplay.scrub(function (err, res, body) {
      server.close()
      airplay.destroy()
      t.error(err)
      t.equal(res.statusCode, 200)
      t.deepEqual(body, Buffer(0))
      t.end()
    })
  })
})

test('set scrub', function (t) {
  var server = http.createServer(function (req, res) {
    t.equal(req.method, 'POST')
    t.equal(req.url, '/scrub?position=42')
    res.end()
  })

  server.on('upgrade', onUpgrade)

  server.listen(function () {
    var airplay = new AirPlay('localhost', server.address().port)

    airplay.scrub(42, function (err, res, body) {
      server.close()
      airplay.destroy()
      t.error(err)
      t.equal(res.statusCode, 200)
      t.deepEqual(body, Buffer(0))
      t.end()
    })
  })
})

test('rate', function (t) {
  var server = http.createServer(function (req, res) {
    t.equal(req.method, 'POST')
    t.equal(req.url, '/rate?value=0.42')
    res.end()
  })

  server.on('upgrade', onUpgrade)

  server.listen(function () {
    var airplay = new AirPlay('localhost', server.address().port)

    airplay.rate(0.42, function (err, res, body) {
      server.close()
      airplay.destroy()
      t.error(err)
      t.equal(res.statusCode, 200)
      t.deepEqual(body, Buffer(0))
      t.end()
    })
  })
})

test('pause', function (t) {
  var server = http.createServer(function (req, res) {
    t.equal(req.method, 'POST')
    t.equal(req.url, '/rate?value=0')
    res.end()
  })

  server.on('upgrade', onUpgrade)

  server.listen(function () {
    var airplay = new AirPlay('localhost', server.address().port)

    airplay.pause(function (err, res, body) {
      server.close()
      airplay.destroy()
      t.error(err)
      t.equal(res.statusCode, 200)
      t.deepEqual(body, Buffer(0))
      t.end()
    })
  })
})

test('resume', function (t) {
  var server = http.createServer(function (req, res) {
    t.equal(req.method, 'POST')
    t.equal(req.url, '/rate?value=1')
    res.end()
  })

  server.on('upgrade', onUpgrade)

  server.listen(function () {
    var airplay = new AirPlay('localhost', server.address().port)

    airplay.resume(function (err, res, body) {
      server.close()
      airplay.destroy()
      t.error(err)
      t.equal(res.statusCode, 200)
      t.deepEqual(body, Buffer(0))
      t.end()
    })
  })
})

test('stop', function (t) {
  var server = http.createServer(function (req, res) {
    t.equal(req.method, 'POST')
    t.equal(req.url, '/stop')
    res.end()
  })

  server.on('upgrade', onUpgrade)

  server.listen(function () {
    var airplay = new AirPlay('localhost', server.address().port)

    airplay.stop(function (err, res, body) {
      server.close()
      airplay.destroy()
      t.error(err)
      t.equal(res.statusCode, 200)
      t.deepEqual(body, Buffer(0))
      t.end()
    })
  })
})

test('playbackInfo', function (t) {
  var server = http.createServer(function (req, res) {
    t.equal(req.method, 'GET')
    t.equal(req.url, '/playback-info')
    res.end()
  })

  server.on('upgrade', onUpgrade)

  server.listen(function () {
    var airplay = new AirPlay('localhost', server.address().port)

    airplay.playbackInfo(function (err, res, body) {
      server.close()
      airplay.destroy()
      t.error(err)
      t.equal(res.statusCode, 200)
      t.deepEqual(body, Buffer(0))
      t.end()
    })
  })
})

test('get property', function (t) {
  var server = http.createServer(function (req, res) {
    t.equal(req.method, 'POST')
    t.equal(req.url, '/getProperty?foo')
    res.end()
  })

  server.on('upgrade', onUpgrade)

  server.listen(function () {
    var airplay = new AirPlay('localhost', server.address().port)

    airplay.property('foo', function (err, res, body) {
      server.close()
      airplay.destroy()
      t.error(err)
      t.equal(res.statusCode, 200)
      t.deepEqual(body, Buffer(0))
      t.end()
    })
  })
})

test('set property', function (t) {
  var server = http.createServer(function (req, res) {
    t.equal(req.method, 'PUT')
    t.equal(req.url, '/setProperty?foo')
    req.on('data', function (chunk) {
      t.deepEqual(bplist.parseBuffer(chunk)[0], { foo: 'bar' })
      res.end()
    })
  })

  server.on('upgrade', onUpgrade)

  server.listen(function () {
    var airplay = new AirPlay('localhost', server.address().port)

    airplay.property('foo', { foo: 'bar' }, function (err, res, body) {
      server.close()
      airplay.destroy()
      t.error(err)
      t.equal(res.statusCode, 200)
      t.deepEqual(body, Buffer(0))
      t.end()
    })
  })
})

function onUpgrade (req, socket, head) {
  socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
               'Upgrade: PTTH/1.0\r\n' +
               'Connection: Upgrade\r\n' +
               '\r\n')
  socket.write('POST /event HTTP/1.1\r\n' +
               'Content-Type: application/x-apple-plist\r\n' +
               'Content-Length: 342\r\n' +
               'X-Apple-Session-ID: 00000000-0000-0000-0000-000000000000\r\n' +
               '\r\n' +
               '<?xml version="1.0" encoding="UTF-8"?>\r\n' +
               '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"\r\n' +
               '  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\r\n' +
               '<plist version="1.0">\r\n' +
               ' <dict>\r\n' +
               '  <key>category</key>\r\n' +
               '  <string>video</string>\r\n' +
               '  <key>sessionID</key>\r\n' +
               '  <integer>13</integer>\r\n' +
               '  <key>state</key>\r\n' +
               '  <string>paused</string>\r\n' +
               ' </dict>\r\n' +
               '</plist>')
}
