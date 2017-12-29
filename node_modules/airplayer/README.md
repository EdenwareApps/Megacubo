# airplayer

Query your local network for Apple TV's or other AirPlay video
compatible devices and have them play videos.

[![Build status](https://travis-ci.org/watson/airplayer.svg?branch=master)](https://travis-ci.org/watson/airplayer)
[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](https://github.com/feross/standard)

## Installation

For programmatic use, install using:

```
npm install airplayer --save
```

Or install globally to use via the command line:

```
npm install airplayer --global
```

## Example Programmatic Usage

```js
var airplayer = require('airplayer')

var list = airplayer()

list.on('update', function (player) {
  console.log('Found new AirPlay device:', player.name)
  player.play(url)
})
```

## Example CLI Usage

If you install the module gobally, simply run the `airplayer` command
with the file you want to play as the first argument.

The `airplayer` command will look for an Apple TV on your local network.
When one is found, it will start playing the chosen video. Use the
option `-i` to select the Apple TV to stream to.

```
$ airplayer my-video.m4v
```

Note that the video must be in a format supported by your Apple TV in
order for `airplayer` to play it.

## API

### `var list = airplayer()`

Creates a AirPlay list. When creating a new list it will call
`list.update()` once. It is up to you to call afterwards in case you
want to update the list.

### `list.players`

An array of the players that have been found on the local network so
far.

### `list.update()`

Updates the player list by querying the local network for `airplay`
instances.

### `list.destroy()`

Stop browsing for players.

### `list.on('update', player)`

Emitted when a new player is found on the local network.

The `player` is an instance of
[`airplay-protocol`](https://github.com/watson/airplay-protocol) with
the following extra properties:

- `name` - The human readable name of the AirPlay device

## License

MIT
