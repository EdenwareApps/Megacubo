
var test = require('tape')

test('ipSet.contains respects ipSet.add', function (t) {
  var ipSet = require('../')()
  var localhost = '127.0.0.1'

  t.notOk(ipSet.contains(localhost))
  ipSet.add(localhost)
  t.ok(ipSet.contains(localhost))
  t.end()
})

// TODO: more thorough unit tests

