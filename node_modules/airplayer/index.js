'use strict'

var EventEmitter = require('events').EventEmitter
var Bonjour = require('bonjour')
var AirPlay = require('airplay-protocol')

module.exports = function () {
  var bonjour = new Bonjour()
  var list = new EventEmitter()
  var found = []
  var browser = bonjour.find({ type: 'airplay' }, function (service) {
    if (~found.indexOf(service.fqdn)) return
    found.push(service.fqdn)

    var player = new AirPlay(service.host, service.port)
    player.name = service.name
    player.on('event', function (event) {
      if (event.state === 'stopped') list.destroy()
    })

    list.players.push(player)
    list.emit('update', player)
  })

  list.players = []
  list.update = browser.update.bind(browser)
  list.destroy = bonjour.destroy.bind(bonjour)

  return list
}
