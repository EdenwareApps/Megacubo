# consume-until

Consume a stream until a given pattern is found.

[![Build status](https://travis-ci.org/watson/consume-until.svg?branch=master)](https://travis-ci.org/watson/consume-until)
[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](https://github.com/feross/standard)

## Usage

```js
var net = require('net')
var consumeUntil = require('consume-until')

var socket = net.connect({ host: 'example.com', port: 80 })

socket.write('GET / HTTP/1.1\r\n')
socket.write('Host: example.com\r\n')
socket.write('\r\n')

consumeUntil(socket, '\r\n\r\n', function (err, headers) {
  if (err) throw err

  console.log('HTTP response headers:')
  console.log(headers)
  
  console.log('HTTP response body:')
  socket.pipe(process.stdout)
})
```

## API

### `consumeUntil(stream, pattern, callback)`

The module exposes a single function which takes 3 arguments:

- `stream` - The stream to consume
- `pattern` - Either a string or a buffer containing the pattern to look
  for in the `stream`
- `callback` - The callback will be called when the `pattern` is
  detected. The data consumed up until the pattern will be given as the
  second argument. An error is given as the first argument if the
  `stream` either ends before the `pattern` is found or emits an error

## License

MIT
