# simple-sha1
simple-sha1 wraps three fast SHA1 implementations, and exposes a simple api for generating hashes in node ([crypto](http://nodejs.org/api/crypto.html)) and the browser ([WebCryptoAPI](http://www.w3.org/TR/WebCryptoAPI/) || [Rusha](https://github.com/srijs/rusha)).

[![Build status](https://travis-ci.org/michaelrhodes/simple-sha1.png?branch=master)](https://travis-ci.org/michaelrhodes/simple-sha1)

[![Sauce Test Status](https://saucelabs.com/browser-matrix/simple-sha1.svg)](https://saucelabs.com/u/simple-sha1)

## install
```sh
$ npm install simple-sha1
```

## example
```js
var sha1 = require('simple-sha1')

// Because the WebCryptoAPI uses Promises (shudder),
// you have to pass a callback if you want to take
// advantage of its mad-sick performance.

sha1('hey there', function (hash) {
  console.log(hash)
  > 6b1c01703b68cf9b35ab049385900b5c428651b6
})

// However, if you don’t mind always using Rusha in
// the browser, you can just call sha1.sync and be
// done with it.

console.log(sha1.sync('hey there'))
> 6b1c01703b68cf9b35ab049385900b5c428651b6
```

## license
[MIT](http://opensource.org/licenses/MIT)
