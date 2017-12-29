# reverse-http

Create a reverse HTTP connection to an HTTP server that supports
[Reverse HTTP](https://tools.ietf.org/html/draft-lentczner-rhttp-00).

[![Build status](https://travis-ci.org/watson/reverse-http.svg?branch=master)](https://travis-ci.org/watson/reverse-http)
[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](https://github.com/feross/standard)

## Installation

```
npm install reverse-http --save
```

## Usage

```js
var reverseHttp = require('reverse-http')

var opts = {
  hostname: 'example.com',
  path: '/foo'
}

// Open an HTTP connection to example.com and accept reverse HTTP
// requests back to this machine
reverseHttp(opts, function (req, res) {
  console.log('Incoming request:', req.method, req.url)

  res.writeHead(201, {
    'Content-Type': 'text/plain',
    'Content-Length': 11
  })

  res.end('Hello World')
})
```

## API

### `var server = reverseHttp(options[, onRequest])`

Create a reverse HTTP connection to the HTTP server specificed in
`options`. Returns an instance of `ReverseServer`. The `ReverseServer`
inherits from
[`http.Server`](https://nodejs.org/api/http.html#http_class_http_server)
and as such exposes the same API.

Besides the regular `options` inherited from
[`http.request`](https://nodejs.org/api/http.html#http_http_request_options_callback)
the following special options are also available:

- `tls` - create an https connection (default: `false`)
- `rejectUnauthorized` - if `true`, the server certificate is verified
  (default: `true`)

Note that the HTTP method defaults to `POST`.

The optional `onRequest` callback will be attached as a listener to the
`request` event.

The following headers are added by default to the establishing outgoing
HTTP request:

```http
Upgrade: PTTH/1.0
Connection: Upgrade
Content-Length: 0
```

### `server.destroy()`

Close the server and destroy the socket.

## License

MIT
