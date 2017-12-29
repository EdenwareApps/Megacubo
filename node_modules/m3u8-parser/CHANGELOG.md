<a name="4.0.0"></a>
# [4.0.0](https://github.com/videojs/m3u8-parser/compare/v3.0.0...v4.0.0) (2017-11-21)

### Features

* added ability to parse EXT-X-START tags [#31](https://github.com/videojs/m3u8-parser/pull/31)

### BREAKING CHANGES

* camel case module name in rollup config to work with latest rollup [#32](https://github.com/videojs/m3u8-parser/pull/32)

<a name="3.0.0"></a>
# 3.0.0 (2017-06-09)

### Features

* Rollup ([#24](https://github.com/videojs/m3u8-parser/issues/24)) ([47ef11f](https://github.com/videojs/m3u8-parser/commit/47ef11f))


### BREAKING CHANGES

* drop bower support.

## 2.1.0 (2017-02-23)
* parse FORCED attribute of media-groups [#15](https://github.com/videojs/m3u8-parser/pull/15)
* Pass any CHARACTERISTICS value of a track with the track object [#14](https://github.com/videojs/m3u8-parser/pull/14)

## 2.0.1 (2017-01-20)
* Fix: Include the babel ES3 tranform to support IE8 [#13](https://github.com/videojs/m3u8-parser/pull/13)

## 2.0.0 (2017-01-13)
* Manifest object is now initialized with an empty segments arrays
* moved to latest videojs-standard version, brought code into
compliance with the latest eslint rules.

## 1.0.2 (2016-06-07)
* fix the build pipeline
* removed video.js css/js inclusion during tests

## 1.0.1 (2016-06-07)
* remove dependence on video.js
* added contributors to package.json

## 1.0.0 (2016-06-03)
Initial Release

