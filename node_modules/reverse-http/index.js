'use strict'

var util = require('util')
var net = require('net')
var tls = require('tls')
var http = require('http')
var once = require('once')
var consume = require('consume-http-header')

module.exports = ReverseServer

util.inherits(ReverseServer, http.Server)

function ReverseServer (opts, onRequest) {
  if (!(this instanceof ReverseServer)) return new ReverseServer(opts, onRequest)

  var server = this
  var closed = false
  var upgradeRequest = generateRequest(opts)

  http.Server.call(this)

  this.setTimeout(0)
  this.on('close', onClose)
  if (onRequest) this.on('request', onRequest)

  connect()

  function connect () {
    if (closed) return

    if (opts.tls) {
      server._socket = tls.connect(opts.port, opts.host, {
        servername: opts.servername || opts.host,
        rejectUnauthorized: opts.rejectUnauthorized !== false
      })
      server._socket.on('secureConnect', upgrade)
    } else {
      server._socket = net.connect(opts.port, opts.host)
      server._socket.on('connect', upgrade)
    }
    server._socket.on('error', onError)

    function upgrade () {
      var onClose = once(connect)
      server._socket.on('close', onClose)
      server._socket.on('end', onClose)

      consume(server._socket, function (err, head) {
        if (err) {
          server.emit('error', err)
          server.close()
        } else if (head.statusCode === 101 &&
            head.headers.connection &&
            head.headers.connection.toLowerCase() === 'upgrade' &&
            head.headers.upgrade === 'PTTH/1.0') {
          server.emit('connection', server._socket)
        } else {
          server.emit('error', new Error('Unexpected response to PTTH/1.0 Upgrade request'))
          server.close()
        }
      })

      server._socket.write(upgradeRequest)
    }
  }

  function onClose () {
    closed = true
  }

  function onError (err) {
    server.emit('error', err)
  }
}

ReverseServer.prototype.destroy = function () {
  this.close()
  this._socket.destroy()
}

function generateRequest (opts) {
  opts = defaultOptions(opts)

  return Object.keys(opts.headers).reduce(function (s, field) {
    var value = opts.headers[field]
    if (!Array.isArray(value)) value = [value]
    return value.reduce(function (s, value) {
      return s + field + ': ' + value + '\r\n'
    }, s)
  }, opts.method + ' ' + opts.path + ' HTTP/1.1\r\n') + '\r\n'
}

function defaultOptions (opts) {
  if (!opts) opts = {}
  if (!opts.method) opts.method = 'POST'
  if (!opts.host) opts.host = opts.hostname || 'localhost'
  if (!opts.path) opts.path = '/'
  if (!opts.headers) opts.headers = {}
  if (!opts.headers['Host']) opts.headers['Host'] = formatHostHeader(opts.host, opts.port, opts.tls)
  if (!opts.headers['Upgrade']) opts.headers['Upgrade'] = 'PTTH/1.0'
  if (!opts.headers['Connection']) opts.headers['Connection'] = 'Upgrade'
  if (!opts.headers['Content-Length']) opts.headers['Content-Length'] = 0
  return opts
}

// The following algorithm is lifted from Node core:
// https://github.com/nodejs/node/blob/296bfd2/lib/_http_client.js#L90-L103
function formatHostHeader (host, port, tls) {
  var defaultPort = tls ? 443 : 80
  var posColon = -1

  // For the Host header, ensure that IPv6 addresses are enclosed
  // in square brackets, as defined by URI formatting
  // https://tools.ietf.org/html/rfc3986#section-3.2.2
  if ((posColon = host.indexOf(':')) !== -1 &&
      (posColon = host.indexOf(':', posColon) !== -1) &&
      host[0] !== '[') {
    host = '[' + host + ']'
  }

  if (port && +port !== defaultPort) {
    host += ':' + port
  }

  return host
}
