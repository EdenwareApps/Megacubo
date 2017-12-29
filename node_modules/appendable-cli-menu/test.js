'use strict'

// for now just test that the code load and runs without throwing
var menu = require('./')
var foos = menu('foo', function () {})
foos.add('bar')

process.exit()
