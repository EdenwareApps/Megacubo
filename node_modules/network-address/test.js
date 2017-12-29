var tape = require('tape')
var address = require('./')

tape('ipv4', function (t) {
  t.ok(/^\d+\.\d+\.\d+\.\d+$/.test(address()), 'looks like a ipv4')
  t.end()
})

tape('ipv4 #2', function (t) {
  t.ok(/^\d+\.\d+\.\d+\.\d+$/.test(address.ipv4()), 'looks like a ipv4')
  t.end()
})

tape('ipv4 #3', function (t) {
  t.ok(/^\d+\.\d+\.\d+\.\d+$/.test(address.ipv4('lo')), 'looks like a ipv4')
  t.end()
})

tape('ipv6', function (t) {
  t.ok(/([0-f]*:)?([0-f]*:)?([0-f]*:)?([0-f]*:)?$/.test(address.ipv6()), 'looks like a ipv6')
  t.end()
})
