# node-miniget

A small http(s) GET library with only redirects, concatenating, streaming, and no dependencies. This keeps filesize small for potential browser use.

[![Build Status](https://secure.travis-ci.org/fent/node-miniget.svg)](http://travis-ci.org/fent/node-miniget)
[![Dependency Status](https://david-dm.org/fent/node-miniget.svg)](https://david-dm.org/fent/node-miniget)
[![codecov](https://codecov.io/gh/fent/node-miniget/branch/master/graph/badge.svg)](https://codecov.io/gh/fent/node-miniget)


# Usage

Concatenates a response

```js
const miniget = require('miniget');

miniget('http://mywebsite.com', (err, body) => {
  console.log('webpage contents: ', body);
}));
```

Request can be streamed right away

```js
miniget('http://api.mywebsite.com/v1/messages.json')
  .pipe(someWritableStream());
```


# API

### miniget(url, [options], [callback(err, body)])

Makes a GET request. `options` can have any properties from the [`http.request()` function](https://nodejs.org/api/http.html#http_http_request_options_callback), in addition to

* `maxRedirects` - Default is `3`.
* `highWaterMark` - Amount of data to buffer when in stream mode.
* `transform` - Use this to add additional features. Called with the object that `http.get()` or `https.get()` would be called with. Must return a transformed object.

If `callback` is given, will concatenate the response, and call `callback` with a possible error, and the response body.

Miniget returns a readable stream if `callback` is not given, errors will then be emitted on the stream. Returned stream also contains an `.abort()` method.


# Install

    npm install miniget


# Tests
Tests are written with [mocha](https://mochajs.org)

```bash
npm test
```

# License
MIT
