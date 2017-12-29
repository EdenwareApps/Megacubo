# appendable-cli-menu

A Node.js module to show a menu in the terminal. Items in the menu can
be added continuously and the user can choose any available item at any
time.

[![Build status](https://travis-ci.org/watson/appendable-cli-menu.svg?branch=master)](https://travis-ci.org/watson/appendable-cli-menu)
[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](https://github.com/feross/standard)

## Installation

```
npm install appendable-cli-menu
```

## Usage

In this example we use the
[bonjour/zeroconf](http://github.com/watson/bonjour) protocol to look
for http servers on the local network. We add them to the menu as they
are discovered and let the user choose one:

```js
var bonjour = require('bonjour')()
var menu = require('appendable-cli-menu')

var servers = menu('Select an HTTP server', function (server) {
  // stop looking when the user have selected an option
  browser.stop()
  console.log('You selected %s (host: %s)', server.name, server.value)
})

var browser = bonjour.find({ type: 'http' }, function (service) {
  servers.add({ name: service.name, value: service.host })
})
```

The above call the `menu()` will show en empty menu to the user:

```
? Select an HTTP server (waiting...)

```

The subsequent calls to the `servers.add()` will add new options to the
menu as they become available:

```
? Select an HTTP server (use arrow keys)
> mafintosh
  feross
  watson

```

The user can choose an item from the menu at any time. When he does, the
callback provided to `menu()` will be called.

## License

MIT
