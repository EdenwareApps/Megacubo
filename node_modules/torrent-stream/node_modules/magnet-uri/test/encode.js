var magnet = require('../')
var test = require('tape')

test('encode: complicated magnet uri (multiple xt params, and as, xs)', function (t) {
  var uri = magnet.encode({
    xt: [
      'urn:ed2k:354B15E68FB8F36D7CD88FF94116CDC1',
      'urn:tree:tiger:7N5OAMRNGMSSEUE3ORHOKWN4WWIQ5X4EBOOTLJY',
      'urn:btih:QHQXPYWMACKDWKP47RRVIV7VOURXFE5Q'
    ],
    xl: '10826029',
    dn: 'mediawiki-1.15.1.tar.gz',
    tr: [
      'udp://tracker.openbittorrent.com:80/announce'
    ],
    as: 'http://download.wikimedia.org/mediawiki/1.15/mediawiki-1.15.1.tar.gz',
    xs: [
      'http://cache.example.org/XRX2PEFXOOEJFRVUCX6HMZMKS5TWG4K5',
      'dchub://example.org'
    ]
  })

  t.equal(uri, 'magnet:?xt=urn:ed2k:354B15E68FB8F36D7CD88FF94116CDC1&xt=urn:tree:tiger:7N5OAMRNGMSSEUE3ORHOKWN4WWIQ5X4EBOOTLJY&xt=urn:btih:QHQXPYWMACKDWKP47RRVIV7VOURXFE5Q&xl=10826029&dn=mediawiki-1.15.1.tar.gz&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80%2Fannounce&as=http%3A%2F%2Fdownload.wikimedia.org%2Fmediawiki%2F1.15%2Fmediawiki-1.15.1.tar.gz&xs=http%3A%2F%2Fcache.example.org%2FXRX2PEFXOOEJFRVUCX6HMZMKS5TWG4K5&xs=dchub%3A%2F%2Fexample.org')
  t.end()
})

test('encode: simple magnet uri using convenience names', function (t) {
  var obj = {
    xt: 'urn:btih:d2474e86c95b19b8bcfdb92bc12c9d44667cfa36',
    dn: 'Leaves of Grass by Walt Whitman.epub',
    name: 'Leaves of Grass by Walt Whitman.epub',
    infoHash: 'd2474e86c95b19b8bcfdb92bc12c9d44667cfa36',
    tr: [
      'udp://tracker.openbittorrent.com:80',
      'udp://tracker.publicbt.com:80',
      'udp://tracker.istole.it:6969',
      'udp://tracker.ccc.de:80',
      'udp://open.demonii.com:1337'
    ],
    announce: [
      'udp://tracker.openbittorrent.com:80',
      'udp://tracker.publicbt.com:80',
      'udp://tracker.istole.it:6969',
      'udp://tracker.ccc.de:80',
      'udp://open.demonii.com:1337'
    ],
    announceList: [
      [ 'udp://tracker.openbittorrent.com:80' ],
      [ 'udp://tracker.publicbt.com:80' ],
      [ 'udp://tracker.istole.it:6969' ],
      [ 'udp://tracker.ccc.de:80' ],
      [ 'udp://open.demonii.com:1337' ]
    ],
    urlList: [
      'http://download.wikimedia.org/mediawiki/1.15/mediawiki-1.15.1.tar.gz'
    ],
    ws: 'http://download.wikimedia.org/mediawiki/1.15/mediawiki-1.15.1.tar.gz',
    kt: [ 'hey', 'hey2' ],
    keywords: [ 'hey', 'hey2' ]
  }

  var result = magnet.encode(obj)

  t.equal(result, 'magnet:?xt=urn:btih:d2474e86c95b19b8bcfdb92bc12c9d44667cfa36&dn=Leaves+of+Grass+by+Walt+Whitman.epub&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80&tr=udp%3A%2F%2Ftracker.publicbt.com%3A80&tr=udp%3A%2F%2Ftracker.istole.it%3A6969&tr=udp%3A%2F%2Ftracker.ccc.de%3A80&tr=udp%3A%2F%2Fopen.demonii.com%3A1337&ws=http%3A%2F%2Fdownload.wikimedia.org%2Fmediawiki%2F1.15%2Fmediawiki-1.15.1.tar.gz&kt=hey+hey2')

  t.deepEqual(magnet.decode(result), obj)

  t.end()
})
