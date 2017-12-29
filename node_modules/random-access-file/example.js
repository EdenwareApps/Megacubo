var raf = require('./')
var alloc = require('buffer-alloc-unsafe')

var file = raf('hello.txt', {length: 0})

var buf = alloc(1024)
buf.fill('lo')
write()

function write () {
  if (file.length >= 5 * 1024 * 1024) return done()
  file.write(file.length, buf, write)
}

function done () {
  console.log('wrote hello.txt')
}
