var os = require('os')

function pickInterface (interfaces, family) {
  for (var i in interfaces) {
    for (var j = interfaces[i].length - 1; j >= 0; j--) {
      var face = interfaces[i][j]
      var reachable = family === 'IPv4' || face.scopeid === 0
      if (!face.internal && face.family === family && reachable) return face.address
    }
  }
  return family === 'IPv4' ? '127.0.0.1' : '::1'
}

function reduceInterfaces (interfaces, iface) {
  var ifaces = {}
  for (var i in interfaces) {
    if (i === iface) ifaces[i] = interfaces[i]
  }
  return ifaces
}

function ipv4 (iface) {
  var interfaces = os.networkInterfaces()
  if (iface) interfaces = reduceInterfaces(interfaces, iface)
  return pickInterface(interfaces, 'IPv4')
}

function ipv6 (iface) {
  var interfaces = os.networkInterfaces()
  if (iface) interfaces = reduceInterfaces(interfaces, iface)
  return pickInterface(interfaces, 'IPv6')
}

ipv4.ipv4 = ipv4
ipv4.ipv6 = ipv6

module.exports = ipv4
