'use strict'

var Bonjour = require('bonjour')
var test = require('tape')
var airplayer = require('./')

test('api', function (t) {
  var list = airplayer()

  t.ok(list instanceof require('events').EventEmitter)
  t.deepEqual(list.players, [])

  list.update()
  list.destroy()

  t.end()
})

test('on update', function (t) {
  var list = airplayer()

  list.on('update', function (player) {
    t.ok(player instanceof require('airplay-protocol'))
    t.equal(player.name, 'foo')
    b.destroy()
    list.destroy()
    t.end()
  })

  var b = Bonjour()
  b.publish({ name: 'foo', port: 7000, type: 'airplay' })
})

test('bin', function (t) {
  process.argv[2] = 'foo'
  require('./bin.js')
  t.end()
})

test('end', function (t) {
  t.end()
  process.exit()
})
