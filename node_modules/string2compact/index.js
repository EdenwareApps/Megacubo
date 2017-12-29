var addrToIPPort = require('addr-to-ip-port')
var ipaddr = require('ipaddr.js')

module.exports = function (addrs) {
  if (typeof addrs === 'string') {
    addrs = [ addrs ]
  }

  return Buffer.concat(addrs.map(function (addr) {
    var s = addrToIPPort(addr)
    if (s.length !== 2) {
      throw new Error('invalid address format, expecting: 10.10.10.5:128')
    }

    var ip = ipaddr.parse(s[0])
    var ipBuf = new Buffer(ip.toByteArray())
    var port = Number(s[1])
    var portBuf = new Buffer(2)
    portBuf.writeUInt16BE(port, 0)
    return Buffer.concat([ipBuf, portBuf])
  }))
}

/**
 * Also support this usage:
 *   string2compact.multi([ '10.10.10.5:128', '100.56.58.99:28525' ])
 *
 * for parallelism with the `compact2string` module.
 */
module.exports.multi = module.exports
module.exports.multi6 = module.exports
