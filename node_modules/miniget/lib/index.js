const http        = require('http');
const https       = require('https');
const urlParse    = require('url').parse;
const PassThrough = require('stream').PassThrough;


const httpLibs = { 'http:': http, 'https:': https };
const redirectCodes = { 301: true, 302: true, 303: true, 307: true };

/**
* @param {String} url
* @param {!Object} options
* @param {!Function(Error, http.IncomingMessage, String)} callback
* @return {stream.Readable}
*/
module.exports = (url, options, callback) => {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  } else if (!options) {
    options = {};
  }
  var maxRedirects = options.maxRedirects || 3;
  var stream = new PassThrough({ highWaterMark: options.highWaterMark });
  var req, aborted = false;

  function onError(err) {
    if (callback) {
      callback(err);
    } else {
      stream.emit('error', err);
    }
  }

  function doDownload(url, tryCount) {
    var parsed = urlParse(url);
    var httpLib = httpLibs[parsed.protocol];
    if (!httpLib) {
      setImmediate(() => {
        onError(new Error('Invalid URL: ' + url));
      });
      return stream;
    }

    for (var key in options) {
      parsed[key] = options[key];
    }
    delete parsed.maxRedirects;
    delete parsed.highWaterMark;
    delete parsed.transform;
    if (options.transform) {
      var transform = options.transform;
      parsed = transform(parsed);
    }

    req = httpLib.get(parsed, (res) => {
      if (redirectCodes[res.statusCode] === true) {
        if (tryCount >= maxRedirects) {
          onError(new Error('Too many redirects'));
        } else {
          doDownload(res.headers.location, tryCount + 1);
        }
        return;
      } else if (res.statusCode < 200 || 300 <= res.statusCode) {
        onError(new Error('Status code: ' + res.statusCode));
        return;
      }
      if (callback) {
        var body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          callback(null, res, body);
        });
      } else {
        stream.emit('response', res);
        res.on('error', onError);
        res.pipe(stream);
      }
    });
    req.on('error', onError);
    if (aborted) { req.abort(); }
    stream.emit('request', req);
  }

  stream.abort = () => {
    aborted = true;
    stream.emit('abort');
    if (req) { req.abort(); }
  };

  process.nextTick(() => { doDownload(url, 1); });
  return callback ? null : stream;
};
