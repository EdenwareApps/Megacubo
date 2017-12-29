# airplay-protocol

A low level protocol wrapper on top of the AirPlay HTTP API used to
connect to an Apple TV.

**For a proper AirPlay client, see
[airplayer](https://github.com/watson/airplayer) instead.**

Currently only the video API is implemented.

[![Build status](https://travis-ci.org/watson/airplay-protocol.svg?branch=master)](https://travis-ci.org/watson/airplay-protocol)
[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](https://github.com/feross/standard)

## Installation

```
npm install airplay-protocol --save
```

## Example Usage

```js
var AirPlay = require('airplay-protocol')

var airplay = new AirPlay('apple-tv.local')

airplay.play('http://example.com/video.m4v', function (err) {
  if (err) throw err

  airplay.playbackInfo(function (err, res, body) {
    if (err) throw err
    console.log('Playback info:', body)
  })
})
```

## API

### `new AirPlay(host[, port])`

Initiate a connection to a specific AirPlay server given a host or IP
address and a port. If no port is given, the default port 7000 is used.

Returns an instance of the AirPlay object.

```js
var AirPlay = require('airplay-protocol')

var airplay = new AirPlay('192.168.0.42', 7000)
```

### Event: `event`

```js
function (event) {}
```

Emitted every time the AirPlay server sends an event. Events can hold
different types of data, but will among other things be used to send
updates to the playback state.

Example event object indicating the state of the playback have changed:

```js
{
  category: 'video',
  params: {
    uuid: 'D90C289F-DE6A-480C-A741-1DA92CEEE8C3-40-00000004654E2487'
  },
  sessionID: 3,
  state: 'loading'
}
```

The `event.params` property can potentially hold a lot more data than
shown in this example.

Example event object indicating an update to the access log:

```js
{
  params: {
    uuid: '96388EC8-05C8-4BC4-A8EB-E9B6FCEB1A55-41-000000135E436A63'
  },
  sessionID: 0,
  type: 'accessLogChanged'
}
```

### `airplay.state`

Property holding the latest playback state emitted by the `event` event.
Will be `undefined` if no `event` event have been emitted yet.

Possible states: `loading`, `playing`, `paused` or `stopped`.

### `airplay.serverInfo(callback)`

Get the AirPlay server info.

Arguments:

- `callback` - Will be called when the request have been processed by
  the AirPlay server. The first argument is an optional Error object.
  The second argument is an instance of [`http.IncomingMessage`][1] and
  the third argument is a parsed plist object containing the server info

### `airplay.play(url[, position][, callback])`

Start video playback.

Arguments:

- `url` - The URL to play
- `position` (optional) - A floating point number between `0` and `1`
  where `0` represents the begining of the video and `1` the end.
  Defaults to `0`
- `callback` (optional) - Will be called when the request have been
  processed by the AirPlay server. The first argument is an optional
  Error object. The second argument is an instance of
  [`http.IncomingMessage`][1]

### `airplay.scrub(callback)`

Retrieve the current playback position.

Arguments:

- `callback` - Will be called when the request have been processed by
  the AirPlay server. The first argument is an optional Error object.
  The second argument is an instance of [`http.IncomingMessage`][1] and
  the third argument is the current playback position

### `airplay.scrub(position[, callback])`

Seek to an arbitrary location in the video.

Arguments:

- `position` - A float value representing the location in seconds
- `callback` (optional) - Will be called when the request have been
  processed by the AirPlay server. The first argument is an optional
  Error object. The second argument is an instance of
  [`http.IncomingMessage`][1]

### `airplay.rate(speed[, callback])`

Change the playback rate.

Arguments:

- `speed` - A float value representing the playback rate: 0 is paused, 1
  is playing at the normal speed
- `callback` (optional) - Will be called when the request have been
  processed by the AirPlay server. The first argument is an optional
  Error object. The second argument is an instance of
  [`http.IncomingMessage`][1]

### `airplay.pause([callback])`

Pause playback.

Alias for `airplay.rate(0, callback)`.

### `airplay.resume([callback])`

Resume playback.

Alias for `airplay.rate(1, callback)`.

### `airplay.stop([callback])`

Stop playback.

Arguments:

- `callback` (optional) - Will be called when the request have been
  processed by the AirPlay server. The first argument is an optional
  Error object. The second argument is an instance of
  [`http.IncomingMessage`][1]

### `airplay.playbackInfo(callback)`

Retrieve playback informations such as position, duration, rate,
buffering status and more.

Arguments:

- `callback` - Will be called when the request have been processed by
  the AirPlay server. The first argument is an optional Error object.
  The second argument is an instance of [`http.IncomingMessage`][1] and
  the third argument is a parsed plist object containing the playback info

### `airplay.property(name, callback)`

Get playback property.

Arguments:

- `name` - The name of the property to get
- `callback` - Will be called when the request have been processed by
  the AirPlay server. The first argument is an optional Error object.
  The second argument is an instance of [`http.IncomingMessage`][1] and
  the third argument is a parsed plist object containing the property

### `airplay.property(name, value[, callback])`

Set playback property.

Arguments:

- `name` - The name of the property to set
- `value` - The plist object to set
- `callback` (optional) - Will be called when the request have been
  processed by the AirPlay server. The first argument is an optional
  Error object. The second argument is an instance of
  [`http.IncomingMessage`][1]

### `airplay.destroy()`

Destroy the reverse-http server set up to receive AirPlay events.

## License

MIT

[1]: https://nodejs.org/api/http.html#http_class_http_incomingmessage
