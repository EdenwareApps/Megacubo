# simple-websocket [![travis](https://img.shields.io/travis/feross/simple-websocket/master.svg)](https://travis-ci.org/feross/simple-websocket) [![npm](https://img.shields.io/npm/v/simple-websocket.svg)](https://npmjs.org/package/simple-websocket)

#### Simple, EventEmitter API for WebSockets

[![Sauce Test Status](https://saucelabs.com/browser-matrix/simple-websocket.svg)](https://saucelabs.com/u/simple-websocket)

## features

- **super simple** API for working with WebSockets in the browser
- supports **text and binary data**
- node.js [duplex stream](http://nodejs.org/api/stream.html) interface

This module works in the browser with [browserify](http://browserify.org/), and it's used by [WebTorrent](http://webtorrent.io)!

## install

```
npm install simple-websocket
```

## usage

```js
var SimpleWebsocket = require('simple-websocket')

var socket = new SimpleWebsocket('ws://echo.websocket.org')
socket.on('connect', function () {
  // socket is connected!
  socket.send('sup!')
})

socket.on('data', function (data) {
  console.log('got message: ' + data)
})
```

Note: If you're **NOT** using browserify, then use the standalone `simplewebsocket.min.js`
file included in this repo. This exports a `SimpleWebsocket` function on the `window`.

## api

### `socket = new SimpleWebsocket([opts])`

Create a new WebSocket connection.

If `opts` is specified, then it will be passed through to the underlying superclass, `stream.Duplex`.

### `socket.send(data)`

Send text/binary data to the WebSocket server. `data` can be any of several types:
`String`, `Buffer` (see [buffer](https://github.com/feross/buffer)), `TypedArrayView`
(`Uint8Array`, etc.), `ArrayBuffer`, or `Blob` (in browsers that support it).

Note: If this method is called before the `socket.on('connect')` event has fired, then
data will be buffered.

### `socket.destroy([onclose])`

Destroy and cleanup this websocket connection.

If the optional `onclose` paramter is passed, then it will be registered as a listener on the 'close' event.

### `Socket.WEBSOCKET_SUPPORT`

Detect WebSocket support in the javascript environment.

```js
var Socket = require('simple-websocket')

if (Socket.WEBSOCKET_SUPPORT) {
  // websocket support!
} else {
  // fallback
}
```


## events

### `socket.on('connect', function () {})`

Fired when the websocket connection is ready to use.

### `socket.on('data', function (data) {})`

Received a message from the websocket server.

`data` will be either a `String` or a `Buffer/Uint8Array` (see [buffer](https://github.com/feross/buffer)).
JSON strings will be parsed and the resulting `Object` emitted.

### `socket.on('close', function () {})`

Called when the websocket connection has closed.

### `socket.on('error', function (err) {})`

`err` is an `Error` object.

Fired when a fatal error occurs.

## real-world applications that use simple-websocket

- [StudyNotes](http://www.apstudynotes.org) - Helping students learn faster and better
- [instant.io](https://github.com/feross/instant.io) - Secure, anonymous, streaming file transfer
- [lxjs-chat](https://github.com/feross/lxjs-chat) - Omegle chat clone
- \[ your application here - send a PR \]

## license

MIT. Copyright (c) [Feross Aboukhadijeh](http://feross.org).
