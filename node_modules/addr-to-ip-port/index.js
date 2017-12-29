var ADDR_RE = /^\[?([^\]]+)\]?:(\d+)$/ // ipv4/ipv6/hostname + port

var cache = {}

// reset cache when it gets to 100,000 elements (~ 600KB of ipv4 addresses)
// so it will not grow to consume all memory in long-running processes
var size = 0

module.exports = function addrToIPPort (addr) {
  if (size === 100000) module.exports.reset()
  if (!cache[addr]) {
    var m = ADDR_RE.exec(addr)
    if (!m) throw new Error('invalid addr: ' + addr)
    cache[addr] = [ m[1], Number(m[2]) ]
    size += 1
  }
  return cache[addr]
}

module.exports.reset = function reset () {
  cache = {}
  size = 0
}
