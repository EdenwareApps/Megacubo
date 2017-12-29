(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.videojsDvrseekbar = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (global){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _videoJs = (typeof window !== "undefined" ? window['videojs'] : typeof global !== "undefined" ? global['videojs'] : null);

var _videoJs2 = _interopRequireDefault(_videoJs);

// Default options for the plugin.
var defaults = {
  startTime: 0
};

var SeekBar = _videoJs2['default'].getComponent('SeekBar');

SeekBar.prototype.dvrTotalTime = function (player) {
  var time = player.seekable();

  return time && time.length ? time.end(0) - time.start(0) : 0;
};

SeekBar.prototype.handleMouseMove = function (e) {
  var bufferedTime = undefined;
  var newTime = undefined;

  bufferedTime = newTime = this.player_.seekable();

  if (bufferedTime && bufferedTime.length) {
    var progress = this.calculateDistance(e) * this.dvrTotalTime(this.player_);

    newTime = bufferedTime.start(0) + progress;
    for (; newTime >= bufferedTime.end(0);) {
      newTime -= 0.1;
    }

    this.player_.currentTime(newTime);
  }
};

SeekBar.prototype.updateAriaAttributes = function () {
  var seekableRanges = this.player_.seekable() || [];

  if (seekableRanges.length) {
    var lastSeekableTime = seekableRanges.end(0);
    var cachedCTime = this.player_.getCache().currentTime;
    var currentTime = this.player_.scrubbing ? cachedCTime : this.player_.currentTime();
    var timeToLastSeekable = undefined;

    // Get difference between last seekable moment and current time
    timeToLastSeekable = lastSeekableTime - currentTime;
    if (timeToLastSeekable < 0) {
      timeToLastSeekable = 0;
    }

    // Update current time control
    var formattedTime = _videoJs2['default'].formatTime(timeToLastSeekable, lastSeekableTime);
    var formattedPercentage = Math.round(100 * this.getPercent(), 2);

    this.el_.setAttribute('aria-valuenow', formattedPercentage);
    this.el_.setAttribute('aria-valuetext', (currentTime ? '' : '-') + formattedTime);
  }
};

/**
 * Function to invoke when the player is ready.
 *
 * This is a great place for your plugin to initialize itself. When this
 * function is called, the player will have its DOM and child components
 * in place.
 *
 * @function onPlayerReady
 * @param    {Player} player
 * @param    {Object} [options={}]
 */
var onPlayerReady = function onPlayerReady(player, options) {
  player.addClass('vjs-dvrseekbar');
  player.controlBar.addClass('vjs-dvrseekbar-control-bar');

  if (player.controlBar.progressControl) {
    player.controlBar.progressControl.addClass('vjs-dvrseekbar-progress-control');
  }

  // ADD Live Button:
  var btnLiveEl = document.createElement('div');
  var newLink = document.createElement('a');

  btnLiveEl.className = 'vjs-live-button vjs-control';

  newLink.innerHTML = document.getElementsByClassName('vjs-live-display')[0].innerHTML;
  newLink.id = 'liveButton';

  if (!player.paused()) {
    newLink.className = 'vjs-live-label onair';
  }

  var clickHandler = function clickHandler(e) {
    player.currentTime(player.seekable().end(0));
    player.play();
  };

  if (newLink.addEventListener) {
    // DOM method
    newLink.addEventListener('click', clickHandler, false);
  } else if (newLink.attachEvent) {
    // this is for IE, because it doesn't support addEventListener
    newLink.attachEvent('onclick', function () {
      return clickHandler.apply(newLink, [window.event]);
    });
  }

  btnLiveEl.appendChild(newLink);

  var controlBar = document.getElementsByClassName('vjs-control-bar')[0];
  var insertBeforeNode = document.getElementsByClassName('vjs-progress-control')[0];

  controlBar.insertBefore(btnLiveEl, insertBeforeNode);

  _videoJs2['default'].log('dvrSeekbar Plugin ENABLED!', options);
};

var onTimeUpdate = function onTimeUpdate(player, e) {
  var time = player.seekable();
  var btnLiveEl = document.getElementById('liveButton');

  // When any tech is disposed videojs will trigger a 'timeupdate' event
  // when calling stopTrackingCurrentTime(). If the tech does not have
  // a seekable() method, time will be undefined
  if (!time || !time.length) {
    return;
  }

  player.duration(player.seekable().end(0));

  if (time.end(0) - player.currentTime() < 30) {
    btnLiveEl.className = 'label onair';
  } else {
    btnLiveEl.className = 'label';
  }

  player.duration(player.seekable().end(0));
};

/**
 * A video.js plugin.
 *
 * In the plugin function, the value of `this` is a video.js `Player`
 * instance. You cannot rely on the player being in a "ready" state here,
 * depending on how the plugin is invoked. This may or may not be important
 * to you; if not, remove the wait for "ready"!
 *
 * @function dvrseekbar
 * @param    {Object} [options={}]
 *           An object of options left to the plugin author to define.
 */
var dvrseekbar = function dvrseekbar(options) {
  var _this = this;

  if (!options) {
    options = defaults;
  }

  this.on('timeupdate', function (e) {
    onTimeUpdate(_this, e);
  });

  this.on('play', function (e) {});

  this.on('pause', function (e) {
    var btnLiveEl = document.getElementById('liveButton');

    btnLiveEl.className = 'vjs-live-label';
  });

  this.ready(function () {
    onPlayerReady(_this, _videoJs2['default'].mergeOptions(defaults, options));
  });
};

// Register the plugin with video.js.
// Updated for video.js 6 - https://github.com/videojs/video.js/wiki/Video.js-6-Migration-Guide
var registerPlugin = _videoJs2['default'].registerPlugin || _videoJs2['default'].plugin;

registerPlugin('dvrseekbar', dvrseekbar);

// Include the version number.
dvrseekbar.VERSION = '0.2.6';

exports['default'] = dvrseekbar;
module.exports = exports['default'];

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJDOi9Vc2Vycy9HZW9yZ2UvRGVza3RvcC92aWRlb2pzZHZyL3NyYy9wbHVnaW4uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7Ozs7Ozs7dUJDQW9CLFVBQVU7Ozs7O0FBRTlCLElBQU0sUUFBUSxHQUFHO0FBQ2YsV0FBUyxFQUFFLENBQUM7Q0FDYixDQUFDOztBQUVGLElBQU0sT0FBTyxHQUFHLHFCQUFRLFlBQVksQ0FBQyxTQUFTLENBQUMsQ0FBQzs7QUFFaEQsT0FBTyxDQUFDLFNBQVMsQ0FBQyxZQUFZLEdBQUcsVUFBUyxNQUFNLEVBQUU7QUFDaEQsTUFBSSxJQUFJLEdBQUcsTUFBTSxDQUFDLFFBQVEsRUFBRSxDQUFDOztBQUU3QixTQUFPLElBQUksSUFBSSxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUM7Q0FDOUQsQ0FBQzs7QUFFRixPQUFPLENBQUMsU0FBUyxDQUFDLGVBQWUsR0FBRyxVQUFTLENBQUMsRUFBRTtBQUM5QyxNQUFJLFlBQVksWUFBQSxDQUFDO0FBQ2pCLE1BQUksT0FBTyxZQUFBLENBQUM7O0FBRVosY0FBWSxHQUFHLE9BQU8sR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxDQUFDOztBQUVqRCxNQUFJLFlBQVksSUFBSSxZQUFZLENBQUMsTUFBTSxFQUFFO0FBQ3ZDLFFBQUksUUFBUSxHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQzs7QUFFM0UsV0FBTyxHQUFHLFlBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEdBQUcsUUFBUSxDQUFDO0FB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LFVBQVUsQ0FBQyxDQUFDOzs7QUFHekMsVUFBVSxDQUFDLE9BQU8sR0FBRyxhQUFhLENBQUM7O3FCQUVwQixVQUFVIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsImltcG9ydCB2aWRlb2pzIGZyb20gJ3ZpZGVvLmpzJztcbi8vIERlZmF1bHQgb3B0aW9ucyBmb3IgdGhlIHBsdWdpbi5cbmNvbnN0IGRlZmF1bHRzID0ge1xuICBzdGFydFRpbWU6IDBcbn07XG5cbmNvbnN0IFNlZWtCYXIgPSB2aWRlb2pzLmdldENvbXBvbmVudCgnU2Vla0JhcicpO1xuXG5TZWVrQmFyLnByb3RvdHlwZS5kdnJUb3RhbFRpbWUgPSBmdW5jdGlvbihwbGF5ZXIpIHtcbiAgbGV0IHRpbWUgPSBwbGF5ZXIuc2Vla2FibGUoKTtcblxuICByZXR1cm4gdGltZSAmJiB0aW1lLmxlbmd0aCA/IHRpbWUuZW5kKDApIC0gdGltZS5zdGFydCgwKSA6IDA7XG59O1xuXG5TZWVrQmFyLnByb3RvdHlwZS5oYW5kbGVNb3VzZU1vdmUgPSBmdW5jdGlvbihlKSB7XG4gIGxldCBidWZmZXJlZFRpbWU7XG4gIGxldCBuZXdUaW1lO1xuXG4gIGJ1ZmZlcmVkVGltZSA9IG5ld1RpbWUgPSB0aGlzLnBsYXllcl8uc2Vla2FibGUoKTtcblxuICBpZiAoYnVmZmVyZWRUaW1lICYmIGJ1ZmZlcmVkVGltZS5sZW5ndGgpIHtcbiAgICBsZXQgcHJvZ3Jlc3MgPSB0aGlzLmNhbGN1bGF0ZURpc3RhbmNlKGUpICogdGhpcy5kdnJUb3RhbFRpbWUodGhpcy5wbGF5ZXJfKTtcblxuICAgIG5ld1RpbWUgPSBidWZmZXJlZFRpbWUuc3RhcnQoMCkgKyBwcm9ncmVzcztcbiAgICBmb3IgKDsgbmV3VGltZSA+PSBidWZmZXJlZFRpbWUuZW5kKDApOykge1xuICAgICAgbmV3VGltZSAtPSAwLjE7XG4gICAgfVxuXG4gICAgdGhpcy5wbGF5ZXJfLmN1cnJlbnRUaW1lKG5ld1RpbWUpO1xuICB9XG59O1xuXG5TZWVrQmFyLnByb3RvdHlwZS51cGRhdGVBcmlhQXR0cmlidXRlcyA9IGZ1bmN0aW9uKCkge1xuICBjb25zdCBzZWVrYWJsZVJhbmdlcyA9IHRoaXMucGxheWVyXy5zZWVrYWJsZSgpIHx8IFtdO1xuXG4gIGlmIChzZWVrYWJsZVJhbmdlcy5sZW5ndGgpIHtcbiAgICBjb25zdCBsYXN0U2Vla2FibGVUaW1lID0gc2Vla2FibGVSYW5nZXMuZW5kKDApO1xuICAgIGNvbnN0IGNhY2hlZENUaW1lID0gdGhpcy5wbGF5ZXJfLmdldENhY2hlKCkuY3VycmVudFRpbWU7XG4gICAgY29uc3QgY3VycmVudFRpbWUgPSB0aGlzLnBsYXllcl8uc2NydWJiaW5nID8gY2FjaGVkQ1RpbWUgOiB0aGlzLnBsYXllcl8uY3VycmVudFRpbWUoKTtcbiAgICBsZXQgdGltZVRvTGFzdFNlZWthYmxlO1xuXG4gICAgLy8gR2V0IGRpZmZlcmVuY2UgYmV0d2VlbiBsYXN0IHNlZWthYmxlIG1vbWVudCBhbmQgY3VycmVudCB0aW1lXG4gICAgdGltZVRvTGFzdFNlZWthYmxlID0gbGFzdFNlZWthYmxlVGltZSAtIGN1cnJlbnRUaW1lO1xuICAgIGlmICh0aW1lVG9MYXN0U2Vla2FibGUgPCAwKSB7XG4gICAgICB0aW1lVG9MYXN0U2Vla2FibGUgPSAwO1xuICAgIH1cblxuICAgIC8vIFVwZGF0ZSBjdXJyZW50IHRpbWUgY29udHJvbFxuICAgIGNvbnN0IGZvcm1hdHRlZFRpbWUgPSB2aWRlb2pzLmZvcm1hdFRpbWUodGltZVRvTGFzdFNlZWthYmxlLCBsYXN0U2Vla2FibGVUaW1lKTtcbiAgICBjb25zdCBmb3JtYXR0ZWRQZXJjZW50YWdlID0gTWF0aC5yb3VuZCgxMDAgKiB0aGlzLmdldFBlcmNlbnQoKSwgMik7XG5cbiAgICB0aGlzLmVsXy5zZXRBdHRyaWJ1dGUoJ2FyaWEtdmFsdWVub3cnLCBmb3JtYXR0ZWRQZXJjZW50YWdlKTtcbiAgICB0aGlzLmVsXy5zZXRBdHRyaWJ1dGUoJ2FyaWEtdmFsdWV0ZXh0JywgKGN1cnJlbnRUaW1lID8gJycgOiAnLScpICsgZm9ybWF0dGVkVGltZSk7XG4gIH1cbn07XG5cbi8qKlxuICogRnVuY3Rpb24gdG8gaW52b2tlIHdoZW4gdGhlIHBsYXllciBpcyByZWFkeS5cbiAqXG4gKiBUaGlzIGlzIGEgZ3JlYXQgcGxhY2UgZm9yIHlvdXIgcGx1Z2luIHRvIGluaXRpYWxpemUgaXRzZWxmLiBXaGVuIHRoaXNcbiAqIGZ1bmN0aW9uIGlzIGNhbGxlZCwgdGhlIHBsYXllciB3aWxsIGhhdmUgaXRzIERPTSBhbmQgY2hpbGQgY29tcG9uZW50c1xuICogaW4gcGxhY2UuXG4gKlxuICogQGZ1bmN0aW9uIG9uUGxheWVyUmVhZHlcbiAqIEBwYXJhbSAgICB7UGxheWVyfSBwbGF5ZXJcbiAqIEBwYXJhbSAgICB7T2JqZWN0fSBbb3B0aW9ucz17fV1cbiAqL1xuY29uc3Qgb25QbGF5ZXJSZWFkeSA9IChwbGF5ZXIsIG9wdGlvbnMpID0+IHtcbiAgcGxheWVyLmFkZENsYXNzKCd2anMtZHZyc2Vla2JhcicpO1xuICBwbGF5ZXIuY29udHJvbEJhci5hZGRDbGFzcygndmpzLWR2cnNlZWtiYXItY29udHJvbC1iYXInKTtcblxuICBpZiAocGxheWVyLmNvbnRyb2xCYXIucHJvZ3Jlc3NDb250cm9sKSB7XG4gICAgcGxheWVyLmNvbnRyb2xCYXIucHJvZ3Jlc3NDb250cm9sLmFkZENsYXNzKCd2anMtZHZyc2Vla2Jhci1wcm9ncmVzcy1jb250cm9sJyk7XG4gIH1cblxuICAvLyBBREQgTGl2ZSBCdXR0b246XG4gIGxldCBidG5MaXZlRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgbGV0IG5ld0xpbmsgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG5cbiAgYnRuTGl2ZUVsLmNsYXNzTmFtZSA9ICd2anMtbGl2ZS1idXR0b24gdmpzLWNvbnRyb2wnO1xuXG4gIG5ld0xpbmsuaW5uZXJIVE1MID0gZG9jdW1lbnQuZ2V0RWxlbWVudHNCeUNsYXNzTmFtZSgndmpzLWxpdmUtZGlzcGxheScpWzBdLmlubmVySFRNTDtcbiAgbmV3TGluay5pZCA9ICdsaXZlQnV0dG9uJztcblxuICBpZiAoIXBsYXllci5wYXVzZWQoKSkge1xuICAgIG5ld0xpbmsuY2xhc3NOYW1lID0gJ3Zqcy1saXZlLWxhYmVsIG9uYWlyJztcbiAgfVxuXG4gIGxldCBjbGlja0hhbmRsZXIgPSBmdW5jdGlvbihlKSB7XG4gICAgcGxheWVyLmN1cnJlbnRUaW1lKHBsYXllci5zZWVrYWJsZSgpLmVuZCgwKSk7XG4gICAgcGxheWVyLnBsYXkoKTtcbiAgfTtcblxuICBpZiAobmV3TGluay5hZGRFdmVudExpc3RlbmVyKSB7XG4gICAgLy8gRE9NIG1ldGhvZFxuICAgIG5ld0xpbmsuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCBjbGlja0hhbmRsZXIsIGZhbHNlKTtcbiAgfSBlbHNlIGlmIChuZXdMaW5rLmF0dGFjaEV2ZW50KSB7XG4gICAgLy8gdGhpcyBpcyBmb3IgSUUsIGJlY2F1c2UgaXQgZG9lc24ndCBzdXBwb3J0IGFkZEV2ZW50TGlzdGVuZXJcbiAgICBuZXdMaW5rLmF0dGFjaEV2ZW50KCdvbmNsaWNrJywgZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gY2xpY2tIYW5kbGVyLmFwcGx5KG5ld0xpbmssIFsgd2luZG93LmV2ZW50IF0pO1xuICAgIH0pO1xuICB9XG5cbiAgYnRuTGl2ZUVsLmFwcGVuZENoaWxkKG5ld0xpbmspO1xuXG4gIGxldCBjb250cm9sQmFyID0gZG9jdW1lbnQuZ2V0RWxlbWVudHNCeUNsYXNzTmFtZSgndmpzLWNvbnRyb2wtYmFyJylbMF07XG4gIGxldCBpbnNlcnRCZWZvcmVOb2RlID0gZG9jdW1lbnQuZ2V0RWxlbWVudHNCeUNsYXNzTmFtZSgndmpzLXByb2dyZXNzLWNvbnRyb2wnKVswXTtcblxuICBjb250cm9sQmFyLmluc2VydEJlZm9yZShidG5MaXZlRWwsIGluc2VydEJlZm9yZU5vZGUpO1xuXG4gIHZpZGVvanMubG9nKCdkdnJTZWVrYmFyIFBsdWdpbiBFTkFCTEVEIScsIG9wdGlvbnMpO1xufTtcblxuY29uc3Qgb25UaW1lVXBkYXRlID0gKHBsYXllciwgZSkgPT4ge1xuICBsZXQgdGltZSA9IHBsYXllci5zZWVrYWJsZSgpO1xuICBsZXQgYnRuTGl2ZUVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2xpdmVCdXR0b24nKTtcblxuICAvLyBXaGVuIGFueSB0ZWNoIGlzIGRpc3Bvc2VkIHZpZGVvanMgd2lsbCB0cmlnZ2VyIGEgJ3RpbWV1cGRhdGUnIGV2ZW50XG4gIC8vIHdoZW4gY2FsbGluZyBzdG9wVHJhY2tpbmdDdXJyZW50VGltZSgpLiBJZiB0aGUgdGVjaCBkb2VzIG5vdCBoYXZlXG4gIC8vIGEgc2Vla2FibGUoKSBtZXRob2QsIHRpbWUgd2lsbCBiZSB1bmRlZmluZWRcbiAgaWYgKCF0aW1lIHx8ICF0aW1lLmxlbmd0aCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHBsYXllci5kdXJhdGlvbihwbGF5ZXIuc2Vla2FibGUoKS5lbmQoMCkpO1xuXG4gIGlmICh0aW1lLmVuZCgwKSAtIHBsYXllci5jdXJyZW50VGltZSgpIDwgMzApIHtcbiAgICBidG5MaXZlRWwuY2xhc3NOYW1lID0gJ2xhYmVsIG9uYWlyJztcbiAgfSBlbHNlIHtcbiAgICBidG5MaXZlRWwuY2xhc3NOYW1lID0gJ2xhYmVsJztcbiAgfVxuXG4gIHBsYXllci5kdXJhdGlvbihwbGF5ZXIuc2Vla2FibGUoKS5lbmQoMCkpO1xufTtcblxuLyoqXG4gKiBBIHZpZGVvLmpzIHBsdWdpbi5cbiAqXG4gKiBJbiB0aGUgcGx1Z2luIGZ1bmN0aW9uLCB0aGUgdmFsdWUgb2YgYHRoaXNgIGlzIGEgdmlkZW8uanMgYFBsYXllcmBcbiAqIGluc3RhbmNlLiBZb3UgY2Fubm90IHJlbHkgb24gdGhlIHBsYXllciBiZWluZyBpbiBhIFwicmVhZHlcIiBzdGF0ZSBoZXJlLFxuICogZGVwZW5kaW5nIG9uIGhvdyB0aGUgcGx1Z2luIGlzIGludm9rZWQuIFRoaXMgbWF5IG9yIG1heSBub3QgYmUgaW1wb3J0YW50XG4gKiB0byB5b3U7IGlmIG5vdCwgcmVtb3ZlIHRoZSB3YWl0IGZvciBcInJlYWR5XCIhXG4gKlxuICogQGZ1bmN0aW9uIGR2cnNlZWtiYXJcbiAqIEBwYXJhbSAgICB7T2JqZWN0fSBbb3B0aW9ucz17fV1cbiAqICAgICAgICAgICBBbiBvYmplY3Qgb2Ygb3B0aW9ucyBsZWZ0IHRvIHRoZSBwbHVnaW4gYXV0aG9yIHRvIGRlZmluZS5cbiAqL1xuY29uc3QgZHZyc2Vla2JhciA9IGZ1bmN0aW9uKG9wdGlvbnMpIHtcbiAgaWYgKCFvcHRpb25zKSB7XG4gICAgb3B0aW9ucyA9IGRlZmF1bHRzO1xuICB9XG5cbiAgdGhpcy5vbigndGltZXVwZGF0ZScsIChlKSA9PiB7XG4gICAgb25UaW1lVXBkYXRlKHRoaXMsIGUpO1xuICB9KTtcblxuICB0aGlzLm9uKCdwbGF5JywgKGUpID0+IHt9KTtcblxuICB0aGlzLm9uKCdwYXVzZScsIChlKSA9PiB7XG4gICAgbGV0IGJ0bkxpdmVFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsaXZlQnV0dG9uJyk7XG5cbiAgICBidG5MaXZlRWwuY2xhc3NOYW1lID0gJ3Zqcy1saXZlLWxhYmVsJztcbiAgfSk7XG5cbiAgdGhpcy5yZWFkeSgoKSA9PiB7XG4gICAgb25QbGF5ZXJSZWFkeSh0aGlzLCB2aWRlb2pzLm1lcmdlT3B0aW9ucyhkZWZhdWx0cywgb3B0aW9ucykpO1xuICB9KTtcbn07XG5cbi8vIFJlZ2lzdGVyIHRoZSBwbHVnaW4gd2l0aCB2aWRlby5qcy5cbi8vIFVwZGF0ZWQgZm9yIHZpZGVvLmpzIDYgLSBodHRwczovL2dpdGh1Yi5jb20vdmlkZW9qcy92aWRlby5qcy93aWtpL1ZpZGVvLmpzLTYtTWlncmF0aW9uLUd1aWRlXG52YXIgcmVnaXN0ZXJQbHVnaW4gPSB2aWRlb2pzLnJlZ2lzdGVyUGx1Z2luIHx8IHZpZGVvanMucGx1Z2luO1xuXG5yZWdpc3RlclBsdWdpbignZHZyc2Vla2JhcicsIGR2cnNlZWtiYXIpO1xuXG4vLyBJbmNsdWRlIHRoZSB2ZXJzaW9uIG51bWJlci5cbmR2cnNlZWtiYXIuVkVSU0lPTiA9ICdfX1ZFUlNJT05fXyc7XG5cbmV4cG9ydCBkZWZhdWx0IGR2cnNlZWtiYXI7XG4iXX0=
