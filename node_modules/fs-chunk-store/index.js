module.exports = Storage

var fs = require('fs')
var mkdirp = require('mkdirp')
var os = require('os')
var parallel = require('run-parallel')
var path = require('path')
var raf = require('random-access-file')
var randombytes = require('randombytes')
var rimraf = require('rimraf')
var thunky = require('thunky')

var TMP
try {
  TMP = fs.statSync('/tmp') && '/tmp'
} catch (err) {
  TMP = os.tmpdir()
}

function Storage (chunkLength, opts) {
  var self = this
  if (!(self instanceof Storage)) return new Storage(chunkLength, opts)
  if (!opts) opts = {}

  self.chunkLength = Number(chunkLength)
  if (!self.chunkLength) throw new Error('First argument must be a chunk length')

  if (opts.files) {
    if (!Array.isArray(opts.files)) {
      throw new Error('`files` option must be an array')
    }
    self.files = opts.files.slice(0).map(function (file, i, files) {
      if (file.path == null) throw new Error('File is missing `path` property')
      if (file.length == null) throw new Error('File is missing `length` property')
      if (file.offset == null) {
        if (i === 0) {
          file.offset = 0
        } else {
          var prevFile = files[i - 1]
          file.offset = prevFile.offset + prevFile.length
        }
      }
      return file
    })
    self.length = self.files.reduce(function (sum, file) { return sum + file.length }, 0)
    if (opts.length != null && opts.length !== self.length) {
      throw new Error('total `files` length is not equal to explicit `length` option')
    }
  } else {
    var len = Number(opts.length) || Infinity
    self.files = [{
      offset: 0,
      path: path.resolve(opts.path || path.join(TMP, 'fs-chunk-store', randombytes(20).toString('hex'))),
      length: len
    }]
    self.length = len
  }

  self.chunkMap = []
  self.closed = false

  self.files.forEach(function (file) {
    file.open = thunky(function (cb) {
      if (self.closed) return cb(new Error('Storage is closed'))
      mkdirp(path.dirname(file.path), function (err) {
        if (err) return cb(err)
        if (self.closed) return cb(new Error('Storage is closed'))
        cb(null, raf(file.path))
      })
    })
  })

  // If the length is Infinity (i.e. a length was not specified) then the store will
  // automatically grow.

  if (self.length !== Infinity) {
    self.lastChunkLength = (self.length % self.chunkLength) || self.chunkLength
    self.lastChunkIndex = Math.ceil(self.length / self.chunkLength) - 1

    self.files.forEach(function (file) {
      var fileStart = file.offset
      var fileEnd = file.offset + file.length

      var firstChunk = Math.floor(fileStart / self.chunkLength)
      var lastChunk = Math.floor((fileEnd - 1) / self.chunkLength)

      for (var p = firstChunk; p <= lastChunk; ++p) {
        var chunkStart = p * self.chunkLength
        var chunkEnd = chunkStart + self.chunkLength

        var from = (fileStart < chunkStart) ? 0 : fileStart - chunkStart
        var to = (fileEnd > chunkEnd) ? self.chunkLength : fileEnd - chunkStart
        var offset = (fileStart > chunkStart) ? 0 : chunkStart - fileStart

        if (!self.chunkMap[p]) self.chunkMap[p] = []

        self.chunkMap[p].push({
          from: from,
          to: to,
          offset: offset,
          file: file
        })
      }
    })
  }
}

Storage.prototype.put = function (index, buf, cb) {
  var self = this
  if (typeof cb !== 'function') cb = noop
  if (self.closed) return nextTick(cb, new Error('Storage is closed'))

  var isLastChunk = (index === self.lastChunkIndex)
  if (isLastChunk && buf.length !== self.lastChunkLength) {
    return nextTick(cb, new Error('Last chunk length must be ' + self.lastChunkLength))
  }
  if (!isLastChunk && buf.length !== self.chunkLength) {
    return nextTick(cb, new Error('Chunk length must be ' + self.chunkLength))
  }

  if (self.length === Infinity) {
    self.files[0].open(function (err, file) {
      if (err) return cb(err)
      file.write(index * self.chunkLength, buf, cb)
    })
  } else {
    var targets = self.chunkMap[index]
    if (!targets) return nextTick(cb, new Error('no files matching the request range'))
    var tasks = targets.map(function (target) {
      return function (cb) {
        target.file.open(function (err, file) {
          if (err) return cb(err)
          file.write(target.offset, buf.slice(target.from, target.to), cb)
        })
      }
    })
    parallel(tasks, cb)
  }
}

Storage.prototype.get = function (index, opts, cb) {
  var self = this
  if (typeof opts === 'function') return self.get(index, null, opts)
  if (self.closed) return nextTick(cb, new Error('Storage is closed'))

  var chunkLength = (index === self.lastChunkIndex)
    ? self.lastChunkLength
    : self.chunkLength

  var rangeFrom = (opts && opts.offset) || 0
  var rangeTo = (opts && opts.length) ? rangeFrom + opts.length : chunkLength

  if (rangeFrom < 0 || rangeFrom < 0 || rangeTo > chunkLength) {
    return nextTick(cb, new Error('Invalid offset and/or length'))
  }

  if (self.length === Infinity) {
    if (rangeFrom === rangeTo) return nextTick(cb, null, Buffer.from(0))
    self.files[0].open(function (err, file) {
      if (err) return cb(err)
      var offset = (index * self.chunkLength) + rangeFrom
      file.read(offset, rangeTo - rangeFrom, cb)
    })
  } else {
    var targets = self.chunkMap[index]
    if (!targets) return nextTick(cb, new Error('no files matching the request range'))
    if (opts) {
      targets = targets.filter(function (target) {
        return target.to > rangeFrom && target.from < rangeTo
      })
      if (targets.length === 0) {
        return nextTick(cb, new Error('no files matching the requested range'))
      }
    }
    if (rangeFrom === rangeTo) return nextTick(cb, null, Buffer.from(0))

    var tasks = targets.map(function (target) {
      return function (cb) {
        var from = target.from
        var to = target.to
        var offset = target.offset

        if (opts) {
          if (to > rangeTo) to = rangeTo
          if (from < rangeFrom) {
            offset += (rangeFrom - from)
            from = rangeFrom
          }
        }

        target.file.open(function (err, file) {
          if (err) return cb(err)
          file.read(offset, to - from, cb)
        })
      }
    })

    parallel(tasks, function (err, buffers) {
      if (err) return cb(err)
      cb(null, Buffer.concat(buffers))
    })
  }
}

Storage.prototype.close = function (cb) {
  var self = this
  if (self.closed) return nextTick(cb, new Error('Storage is closed'))
  self.closed = true

  var tasks = self.files.map(function (file) {
    return function (cb) {
      file.open(function (err, file) {
        // an open error is okay because that means the file is not open
        if (err) return cb(null)
        file.close(cb)
      })
    }
  })
  parallel(tasks, cb)
}

Storage.prototype.destroy = function (cb) {
  var self = this
  self.close(function () {
    var tasks = self.files.map(function (file) {
      return function (cb) {
        rimraf(file.path, { maxBusyTries: 10 }, cb)
      }
    })
    parallel(tasks, cb)
  })
}

function nextTick (cb, err, val) {
  process.nextTick(function () {
    if (cb) cb(err, val)
  })
}

function noop () {}
