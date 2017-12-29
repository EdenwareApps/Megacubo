# consume-http-header

Consume an HTTP request or response stream until all headers have been
read.

Leaves the stream ready to be consumed from the start of the HTTP body.

[![Build status](https://travis-ci.org/watson/consume-http-header.svg?branch=master)](https://travis-ci.org/watson/consume-http-header)
[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](https://github.com/feross/standard)

## Installation

```
npm install consume-http-header --save
```

## Usage

```js
var net = require('net')
var consume = require('consume-http-header')

var socket = net.connect({ host: 'example.com', port: 80 })

socket.write('GET / HTTP/1.1\r\n')
socket.write('Host: example.com\r\n')
socket.write('\r\n')

consume(socket, function (err, req) {
  if (err) throw err

  console.log('New HTTP response:', req.method, req.url)

  console.log('Headers:')
  consooe.log(req.headers)

  console.log('Body:')
  socket.pipe(process.stdout)
})
```

## API

### `consume(stream, callback)`

The module exposes a single function which takes 3 arguments:

- `stream` - The stream to consume
- `callback` - The callback will be called when a complete set of HTTP
  headers have been read from the `stream`. The headers will be given as
  the second argument. An error is given as the first argument if the
  `stream` either ends before all the headers have been read or if the
  `stream` emits an error

#### Consuming the HTTP body

When the `callback` is called, continue consuming the `stream` to get
the body of the request. But be aware of the following gotchas:

- If the `stream` is reused for multiple requests and responses, be
  aware of when the body ends
- If `req.headers['transfer-encoding'] === 'chunked'`, be aware that the
  body is using Chunked Transfer Coding and you have to decode it
  accordingly. Decoding Chunked Transfer Coding is outside the scope of
  this module

## License

MIT
