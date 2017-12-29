'use strict'

var bindexOf = require('buffer-indexof')

module.exports = function (source, delimiter, cb) {
  var len = 0
  var buf

  delimiter = typeof delimiter === 'string' ? Buffer(delimiter) : delimiter

  source.on('end', onEnd)
  source.on('error', onError)

  consume()

  function consume () {
    var chunk

    while ((chunk = source.read()) !== null) {
      var index = bindexOf(chunk, delimiter)

      if (index === -1) {
        len += chunk.length
        buf = buf ? Buffer.concat([buf, chunk], len) : chunk
        continue
      }

      source.unshift(chunk.slice(index))

      chunk = chunk.slice(0, index)
      buf = buf ? Buffer.concat([buf, chunk], len + index) : chunk

      done(null, buf)
      return
    }

    source.once('readable', consume)
  }

  function onError (err) {
    done(err)
  }

  function onEnd () {
    done(new Error('Stream did not contain pattern'))
  }

  function done (err, buf) {
    source.removeListener('end', onEnd)
    source.removeListener('error', onError)
    source.removeListener('readable', consume)
    cb(err, buf)
  }
}
