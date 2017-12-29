'use strict'

var consumeUntil = require('consume-until')
var httpHeaders = require('http-headers')

var endOfHeaders = Buffer('\r\n\r\n')

module.exports = function (socket, cb) {
  consumeUntil(socket, endOfHeaders, function (err, head) {
    if (err) return cb(err)
    socket.read(4) // skip double line break separating head and body
    cb(null, httpHeaders(head))
  })
}
