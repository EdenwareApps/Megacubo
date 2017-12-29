var concat = require('simple-concat')
var get = require('../')
var http = require('http')
var querystring = require('querystring')
var selfSignedHttps = require('self-signed-https')
var str = require('string-to-stream')
var test = require('tape')
var zlib = require('zlib')

test('simple get', function (t) {
  t.plan(5)

  var server = http.createServer(function (req, res) {
    t.equal(req.url, '/path')
    res.statusCode = 200
    res.end('response')
  })

  server.listen(0, function () {
    var port = server.address().port
    get('http://localhost:' + port + '/path', function (err, res) {
      t.error(err)
      t.equal(res.statusCode, 200)
      concat(res, function (err, data) {
        t.error(err)
        t.equal(data.toString(), 'response')
        server.close()
      })
    })
  })
})

test('basic auth', function (t) {
  t.plan(5)

  var server = http.createServer(function (req, res) {
    t.equal(req.headers.authorization, 'Basic Zm9vOmJhcg==')
    res.statusCode = 200
    res.end('response')
  })

  server.listen(0, function () {
    var port = server.address().port
    get('http://foo:bar@localhost:' + port, function (err, res) {
      t.error(err)
      t.equal(res.statusCode, 200)
      concat(res, function (err, data) {
        t.error(err)
        t.equal(data.toString(), 'response')
        server.close()
      })
    })
  })
})

test('follow redirects (up to 10)', function (t) {
  t.plan(15)

  var num = 0
  var server = http.createServer(function (req, res) {
    t.equal(req.url, '/' + num, 'visited /' + num)

    if (num < 10) {
      num += 1
      res.statusCode = 301
      res.setHeader('Location', '/' + num)
      res.end()
    } else {
      res.statusCode = 200
      res.end('response')
    }
  })

  server.listen(0, function () {
    var port = server.address().port
    get('http://localhost:' + port + '/0', function (err, res) {
      t.error(err)
      t.equal(res.statusCode, 200)
      concat(res, function (err, data) {
        t.error(err)
        t.equal(data.toString(), 'response')
        server.close()
      })
    })
  })
})

test('do not follow redirects', function (t) {
  t.plan(2)

  var server = http.createServer(function (req, res) {
    t.equal(req.url, '/0', 'visited /0')

    res.statusCode = 301
    res.setHeader('Location', '/1')
    res.end()
  })

  server.listen(0, function () {
    var port = server.address().port
    get({
      url: 'http://localhost:' + port + '/0',
      maxRedirects: 0
    }, function (err) {
      t.ok(err instanceof Error, 'got error')
      server.close()
    })
  })
})

test('follow redirects (11 is too many)', function (t) {
  t.plan(12)

  var num = 0
  var server = http.createServer(function (req, res) {
    t.equal(req.url, '/' + num, 'visited /' + num)

    if (num < 11) {
      num += 1
      res.statusCode = 301
      res.setHeader('Location', '/' + num)
      res.end()
    } else {
      t.fail('no request to /11 should be made, should error first')
    }
  })

  server.listen(0, function () {
    var port = server.address().port
    get('http://localhost:' + port + '/0', function (err) {
      t.ok(err instanceof Error, 'got error')
      server.close()
    })
  })
})

test('custom headers', function (t) {
  t.plan(2)

  var server = http.createServer(function (req, res) {
    t.equal(req.headers['custom-header'], 'custom-value')
    res.statusCode = 200
    res.end('response')
  })

  server.listen(0, function () {
    var port = server.address().port
    get({
      url: 'http://localhost:' + port,
      headers: {
        'custom-header': 'custom-value'
      }
    }, function (err, res) {
      t.error(err)
      res.resume()
      server.close()
    })
  })
})

test('gzip response', function (t) {
  t.plan(4)

  var server = http.createServer(function (req, res) {
    res.statusCode = 200
    res.setHeader('content-encoding', 'gzip')
    str('response').pipe(zlib.createGzip()).pipe(res)
  })

  server.listen(0, function () {
    var port = server.address().port
    get('http://localhost:' + port, function (err, res) {
      t.error(err)
      t.equal(res.statusCode, 200) // statusCode still works on gunzip stream
      concat(res, function (err, data) {
        t.error(err)
        t.equal(data.toString(), 'response')
        server.close()
      })
    })
  })
})

test('deflate response', function (t) {
  t.plan(4)

  var server = http.createServer(function (req, res) {
    res.statusCode = 200
    res.setHeader('content-encoding', 'deflate')
    str('response').pipe(zlib.createDeflate()).pipe(res)
  })

  server.listen(0, function () {
    var port = server.address().port
    get('http://localhost:' + port, function (err, res) {
      t.error(err)
      t.equal(res.statusCode, 200) // statusCode still works on inflate stream
      concat(res, function (err, data) {
        t.error(err)
        t.equal(data.toString(), 'response')
        server.close()
      })
    })
  })
})

test('https', function (t) {
  t.plan(5)

  var server = selfSignedHttps(function (req, res) {
    t.equal(req.url, '/path')
    res.statusCode = 200
    res.end('response')
  })

  server.listen(0, function () {
    var port = server.address().port
    get({
      url: 'https://localhost:' + port + '/path',
      rejectUnauthorized: false
    }, function (err, res) {
      t.error(err)
      t.equal(res.statusCode, 200)
      concat(res, function (err, data) {
        t.error(err)
        t.equal(data.toString(), 'response')
        server.close()
      })
    })
  })
})

test('redirect https to http', function (t) {
  t.plan(6)

  var httpPort = null
  var httpsPort = null

  var httpsServer = selfSignedHttps(function (req, res) {
    t.equal(req.url, '/path1')
    res.statusCode = 301
    res.setHeader('Location', 'http://localhost:' + httpPort + '/path2')
    res.end()
  })

  var httpServer = http.createServer(function (req, res) {
    t.equal(req.url, '/path2')
    res.statusCode = 200
    res.end('response')
  })

  httpsServer.listen(0, function () {
    httpsPort = httpsServer.address().port
    httpServer.listen(0, function () {
      httpPort = httpServer.address().port
      get({
        url: 'https://localhost:' + httpsPort + '/path1',
        rejectUnauthorized: false
      }, function (err, res) {
        t.error(err)
        t.equal(res.statusCode, 200)
        concat(res, function (err, data) {
          t.error(err)
          t.equal(data.toString(), 'response')
          httpsServer.close()
          httpServer.close()
        })
      })
    })
  })
})

test('redirect http to https', function (t) {
  t.plan(6)

  var httpsPort = null
  var httpPort = null

  var httpServer = http.createServer(function (req, res) {
    t.equal(req.url, '/path1')
    res.statusCode = 301
    res.setHeader('Location', 'https://localhost:' + httpsPort + '/path2')
    res.end()
  })

  var httpsServer = selfSignedHttps(function (req, res) {
    t.equal(req.url, '/path2')
    res.statusCode = 200
    res.end('response')
  })

  httpServer.listen(0, function () {
    httpPort = httpServer.address().port
    httpsServer.listen(0, function () {
      httpsPort = httpsServer.address().port
      get({
        url: 'http://localhost:' + httpPort + '/path1',
        rejectUnauthorized: false
      }, function (err, res) {
        t.error(err)
        t.equal(res.statusCode, 200)
        concat(res, function (err, data) {
          t.error(err)
          t.equal(data.toString(), 'response')
          httpsServer.close()
          httpServer.close()
        })
      })
    })
  })
})

test('post (text body)', function (t) {
  t.plan(5)

  var server = http.createServer(function (req, res) {
    t.equal(req.method, 'POST')
    res.statusCode = 200
    req.pipe(res)
  })

  server.listen(0, function () {
    var port = server.address().port
    var opts = {
      url: 'http://localhost:' + port,
      body: 'this is the body'
    }
    get.post(opts, function (err, res) {
      t.error(err)
      t.equal(res.statusCode, 200)
      concat(res, function (err, data) {
        t.error(err)
        t.equal(data.toString(), 'this is the body')
        server.close()
      })
    })
  })
})

test('post (utf-8 text body)', function (t) {
  t.plan(5)

  var server = http.createServer(function (req, res) {
    t.equal(req.method, 'POST')
    res.statusCode = 200
    req.pipe(res)
  })

  server.listen(0, function () {
    var port = server.address().port
    var opts = {
      url: 'http://localhost:' + port,
      body: 'jedan dva tri četiri'
    }
    get.post(opts, function (err, res) {
      t.error(err)
      t.equal(res.statusCode, 200)
      concat(res, function (err, data) {
        t.error(err)
        t.equal(data.toString(), 'jedan dva tri četiri')
        server.close()
      })
    })
  })
})

test('post (buffer body)', function (t) {
  t.plan(5)

  var server = http.createServer(function (req, res) {
    t.equal(req.method, 'POST')
    res.statusCode = 200
    req.pipe(res)
  })

  server.listen(0, function () {
    var port = server.address().port
    var opts = {
      url: 'http://localhost:' + port,
      body: Buffer.from('this is the body')
    }
    get.post(opts, function (err, res) {
      t.error(err)
      t.equal(res.statusCode, 200)
      concat(res, function (err, data) {
        t.error(err)
        t.equal(data.toString(), 'this is the body')
        server.close()
      })
    })
  })
})

test('post (stream body)', function (t) {
  t.plan(6)

  var server = http.createServer(function (req, res) {
    t.equal(req.method, 'POST')
    res.statusCode = 200
    t.notOk(req.headers['content-length'])
    req.pipe(res)
  })

  server.listen(0, function () {
    var port = server.address().port
    var opts = {
      url: 'http://localhost:' + port,
      body: str('this is the body')
    }
    get.post(opts, function (err, res) {
      t.error(err)
      t.equal(res.statusCode, 200)
      concat(res, function (err, data) {
        t.error(err)
        t.equal(data.toString(), 'this is the body')
        server.close()
      })
    })
  })
})

test('get.concat (post, stream body, and json option)', function (t) {
  t.plan(4)

  var server = http.createServer(function (req, res) {
    res.statusCode = 200
    req.pipe(res)
  })

  server.listen(0, function () {
    var port = server.address().port
    var opts = {
      url: 'http://localhost:' + port,
      body: str('{"a": "b"}'),
      method: 'POST',
      json: true
    }
    get.concat(opts, function (err, res, data) {
      t.error(err)
      t.equal(typeof data, 'object')
      t.deepEqual(Object.keys(data), ['a'])
      t.equal(data.a, 'b')
      server.close()
    })
  })
})

test('get.concat', function (t) {
  t.plan(4)
  var server = http.createServer(function (req, res) {
    res.statusCode = 200
    res.end('blah blah blah')
  })

  server.listen(0, function () {
    var port = server.address().port
    get.concat('http://localhost:' + port, function (err, res, data) {
      t.error(err)
      t.equal(res.statusCode, 200)
      t.ok(Buffer.isBuffer(data), '`data` is type buffer')
      t.equal(data.toString(), 'blah blah blah')
      server.close()
    })
  })
})

test('access `req` object', function (t) {
  t.plan(2)

  var server = http.createServer(function (req, res) {
    res.statusCode = 200
    res.end('response')
  })

  server.listen(0, function () {
    var port = server.address().port
    var req = get('http://localhost:' + port, function (err, res) {
      t.error(err)
      res.resume() // discard data
      server.close()
    })

    req.on('socket', function () {
      t.pass('got `socket` event')
    })
  })
})

test('simple get json', function (t) {
  t.plan(6)

  var server = http.createServer(function (req, res) {
    t.equal(req.url, '/path')
    t.equal(req.headers['accept'], 'application/json')
    res.statusCode = 200
    res.end('{"message":"response"}')
  })

  server.listen(0, function () {
    var port = server.address().port
    var opts = {
      url: 'http://localhost:' + port + '/path',
      json: true
    }
    get(opts, function (err, res) {
      t.error(err)
      t.equal(res.statusCode, 200)
      concat(res, function (err, data) {
        t.error(err)
        t.equal(data.toString(), '{"message":"response"}')
        server.close()
      })
    })
  })
})

test('get.concat json', function (t) {
  t.plan(3)
  var server = http.createServer(function (req, res) {
    res.statusCode = 200
    res.end('{"message":"response"}')
  })

  server.listen(0, function () {
    var port = server.address().port
    var opts = {
      url: 'http://localhost:' + port + '/path',
      json: true
    }
    get.concat(opts, function (err, res, data) {
      t.error(err)
      t.equal(res.statusCode, 200)
      t.equal(data.message, 'response')
      server.close()
    })
  })
})

test('get.concat json error', function (t) {
  t.plan(1)
  var server = http.createServer(function (req, res) {
    res.statusCode = 500
    res.end('not json')
  })

  server.listen(0, function () {
    var port = server.address().port
    var opts = {
      url: 'http://localhost:' + port + '/path',
      json: true
    }
    get.concat(opts, function (err, res, data) {
      t.ok(err instanceof Error)
      server.close()
    })
  })
})

test('post (json body)', function (t) {
  t.plan(5)

  var server = http.createServer(function (req, res) {
    t.equal(req.method, 'POST')
    t.equal(req.headers['content-type'], 'application/json')
    res.statusCode = 200
    req.pipe(res)
  })

  server.listen(0, function () {
    var port = server.address().port
    var opts = {
      method: 'POST',
      url: 'http://localhost:' + port,
      body: {
        message: 'this is the body'
      },
      json: true
    }
    get.concat(opts, function (err, res, data) {
      t.error(err)
      t.equal(res.statusCode, 200)
      t.equal(data.message, 'this is the body')
      server.close()
    })
  })
})

test('post (form, object)', function (t) {
  t.plan(5)

  var formData = {
    foo: 'bar'
  }

  var server = http.createServer(function (req, res) {
    t.equal(req.method, 'POST')
    t.equal(req.headers['content-type'], 'application/x-www-form-urlencoded')
    res.statusCode = 200
    req.pipe(res)
  })

  server.listen(0, function () {
    var port = server.address().port
    var opts = {
      method: 'POST',
      url: 'http://localhost:' + port,
      form: formData
    }
    get.concat(opts, function (err, res, data) {
      t.error(err)
      t.equal(res.statusCode, 200)
      t.deepEqual(querystring.parse(data.toString()), formData)
      server.close()
    })
  })
})

test('post (form, querystring)', function (t) {
  t.plan(5)

  var formData = 'foo=bar'

  var server = http.createServer(function (req, res) {
    t.equal(req.method, 'POST')
    t.equal(req.headers['content-type'], 'application/x-www-form-urlencoded')
    res.statusCode = 200
    req.pipe(res)
  })

  server.listen(0, function () {
    var port = server.address().port
    var opts = {
      method: 'POST',
      url: 'http://localhost:' + port,
      form: formData
    }
    get.concat(opts, function (err, res, data) {
      t.error(err)
      t.equal(res.statusCode, 200)
      t.equal(data.toString(), formData)
      server.close()
    })
  })
})

test('HEAD request', function (t) {
  t.plan(3)

  var server = http.createServer(function (req, res) {
    t.equal(req.method, 'HEAD')
    // Taken from real-world response from HEAD request to GitHub.com
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.setHeader('content-encoding', 'gzip')
    res.setHeader('connection', 'close')
    res.statusCode = 200
    req.pipe(res)
  })

  server.listen(0, function () {
    var port = server.address().port
    var opts = {
      method: 'HEAD',
      url: 'http://localhost:' + port
    }
    get.head(opts, function (err, res) {
      t.error(err)
      t.equal(res.statusCode, 200)
      server.close()
    })
  })
})

test('timeout option', function (t) {
  t.plan(2)

  var server = http.createServer(function (req, res) {
    t.equal(req.url, '/path')
    setTimeout(function () {
      // response should not be sent - should timeout before it's sent
      res.end('response')
    }, 2000)
  })

  server.listen(0, function () {
    var port = server.address().port
    get({
      url: 'http://localhost:' + port + '/path',
      timeout: 1000
    }, function (err, res) {
      t.ok(err instanceof Error)
      server.close()
    })
  })
})
