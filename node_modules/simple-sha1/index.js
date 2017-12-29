var crypto = require('crypto')

function sha1 (buf, cb) {
  var hash = sha1sync(buf)
  process.nextTick(function () {
    cb(hash)
  })
}

function sha1sync (buf) {
  return crypto.createHash('sha1')
    .update(buf)
    .digest('hex')
}

module.exports = sha1
module.exports.sync = sha1sync
