#!/usr/bin/env node
var argv = process.argv.slice(2)

var ipv6
var iface

for (var i = 0; i < argv.length; i++) {
  if (argv[i] === '-6') ipv6 = true
  else if (argv[i][0] !== '-') iface = argv[i]
}

if (ipv6) console.log(require('./index').ipv6(iface))
else console.log(require('./index')(iface))
