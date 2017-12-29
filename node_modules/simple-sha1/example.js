var sha1 = require('./')

// Because the WebCryptoAPI uses Promises (shudder),
// you have to pass a callback if you want to take
// advantage of its mad-sick performance.

sha1('hey there', function (hash) {
  console.log('async:', hash)
})

// However, if you don’t mind always using Rusha in
// the browser, you can just call sha1.sync and be
// done with it.

console.log('sync:', sha1.sync('hey there'))
