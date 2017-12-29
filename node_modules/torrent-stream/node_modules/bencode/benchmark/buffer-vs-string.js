var bencode = require('../')
var buf = require('fs').readFileSync(__dirname + '/test.torrent');
var str = buf.toString('ascii');

suite('buffer vs string', function() {
  bench('buffer', function() {
    bencode.decode(buf);
  })
  bench('string', function() {
    bencode.decode(str);
  })
})
