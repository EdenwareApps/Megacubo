var addrToIPPort = require('../')
var util = require('./util')
var suite = util.suite()

var addrs = []
for (var i = 1; i < 65536; i++) {
  addrs.push('127.0.0.1:' + i)
}

suite
  .add('addr-to-ip-port', function () {
    addrToIPPort.reset()
    var ipPort
    for (var i = 0, len = addrs.length; i < len; i++) {
      ipPort = addrToIPPort(addrs[i])
    }
    for (var i = 0, len = addrs.length; i < len; i++) {
      ipPort = addrToIPPort(addrs[i])
    }
  })
