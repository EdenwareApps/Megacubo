var bencode = require('bencode')
var fixtures = require('webtorrent-fixtures')
var parseTorrentFile = require('../')
var test = require('tape')

var leavesParsed = {
  infoHash: 'd2474e86c95b19b8bcfdb92bc12c9d44667cfa36',
  infoHashBuffer: Buffer.from('d2474e86c95b19b8bcfdb92bc12c9d44667cfa36', 'hex'),
  name: 'Leaves of Grass by Walt Whitman.epub',
  created: new Date('Thu Aug 01 2013 06:27:46 GMT-0700 (PDT)'),
  createdBy: 'uTorrent/3300',
  announce: [],
  urlList: [],
  files: [
    {
      path: 'Leaves of Grass by Walt Whitman.epub',
      name: 'Leaves of Grass by Walt Whitman.epub',
      length: 362017,
      offset: 0
    }
  ],
  length: 362017,
  pieceLength: 16384,
  lastPieceLength: 1569,
  pieces: [
    '1f9c3f59beec079715ec53324bde8569e4a0b4eb',
    'ec42307d4ce5557b5d3964c5ef55d354cf4a6ecc',
    '7bf1bcaf79d11fa5e0be06593c8faafc0c2ba2cf',
    '76d71c5b01526b23007f9e9929beafc5151e6511',
    '0931a1b44c21bf1e68b9138f90495e690dbc55f5',
    '72e4c2944cbacf26e6b3ae8a7229d88aafa05f61',
    'eaae6abf3f07cb6db9677cc6aded4dd3985e4586',
    '27567fa7639f065f71b18954304aca6366729e0b',
    '4773d77ae80caa96a524804dfe4b9bd3deaef999',
    'c9dd51027467519d5eb2561ae2cc01467de5f643',
    '0a60bcba24797692efa8770d23df0a830d91cb35',
    'b3407a88baa0590dc8c9aa6a120f274367dcd867',
    'e88e8338c572a06e3c801b29f519df532b3e76f6',
    '70cf6aee53107f3d39378483f69cf80fa568b1ea',
    'c53b506159e988d8bc16922d125d77d803d652c3',
    'ca3070c16eed9172ab506d20e522ea3f1ab674b3',
    'f923d76fe8f44ff32e372c3b376564c6fb5f0dbe',
    '52164f03629fd1322636babb2c014b7dae582da4',
    '1363965261e6ce12b43701f0a8c9ed1520a70eba',
    '004400a267765f6d3dd5c7beb5bd3c75f3df2a54',
    '560a61801147fa4ec7cf568e703acb04e5610a4d',
    '56dcc242d03293e9446cf5e457d8eb3d9588fd90',
    'c698de9b0dad92980906c026d8c1408fa08fe4ec'
  ],
  info: {
    length: 362017,
    name: Buffer.from('TGVhdmVzIG9mIEdyYXNzIGJ5IFdhbHQgV2hpdG1hbi5lcHVi', 'base64'),
    'piece length': 16384,
    pieces: Buffer.from('H5w/Wb7sB5cV7FMyS96FaeSgtOvsQjB9TOVVe105ZMXvVdNUz0puzHvxvK950R+l4L4GWTyPqvwMK6LPdtccWwFSayMAf56ZKb6vxRUeZREJMaG0TCG/Hmi5E4+QSV5pDbxV9XLkwpRMus8m5rOuinIp2IqvoF9h6q5qvz8Hy225Z3zGre1N05heRYYnVn+nY58GX3GxiVQwSspjZnKeC0dz13roDKqWpSSATf5Lm9PervmZyd1RAnRnUZ1eslYa4swBRn3l9kMKYLy6JHl2ku+odw0j3wqDDZHLNbNAeoi6oFkNyMmqahIPJ0Nn3Nhn6I6DOMVyoG48gBsp9RnfUys+dvZwz2ruUxB/PTk3hIP2nPgPpWix6sU7UGFZ6YjYvBaSLRJdd9gD1lLDyjBwwW7tkXKrUG0g5SLqPxq2dLP5I9dv6PRP8y43LDs3ZWTG+18NvlIWTwNin9EyJja6uywBS32uWC2kE2OWUmHmzhK0NwHwqMntFSCnDroARACiZ3ZfbT3Vx761vTx1898qVFYKYYARR/pOx89WjnA6ywTlYQpNVtzCQtAyk+lEbPXkV9jrPZWI/ZDGmN6bDa2SmAkGwCbYwUCPoI/k7A==', 'base64')
  },
  infoBuffer: Buffer.from('ZDY6bGVuZ3RoaTM2MjAxN2U0Om5hbWUzNjpMZWF2ZXMgb2YgR3Jhc3MgYnkgV2FsdCBXaGl0bWFuLmVwdWIxMjpwaWVjZSBsZW5ndGhpMTYzODRlNjpwaWVjZXM0NjA6H5w/Wb7sB5cV7FMyS96FaeSgtOvsQjB9TOVVe105ZMXvVdNUz0puzHvxvK950R+l4L4GWTyPqvwMK6LPdtccWwFSayMAf56ZKb6vxRUeZREJMaG0TCG/Hmi5E4+QSV5pDbxV9XLkwpRMus8m5rOuinIp2IqvoF9h6q5qvz8Hy225Z3zGre1N05heRYYnVn+nY58GX3GxiVQwSspjZnKeC0dz13roDKqWpSSATf5Lm9PervmZyd1RAnRnUZ1eslYa4swBRn3l9kMKYLy6JHl2ku+odw0j3wqDDZHLNbNAeoi6oFkNyMmqahIPJ0Nn3Nhn6I6DOMVyoG48gBsp9RnfUys+dvZwz2ruUxB/PTk3hIP2nPgPpWix6sU7UGFZ6YjYvBaSLRJdd9gD1lLDyjBwwW7tkXKrUG0g5SLqPxq2dLP5I9dv6PRP8y43LDs3ZWTG+18NvlIWTwNin9EyJja6uywBS32uWC2kE2OWUmHmzhK0NwHwqMntFSCnDroARACiZ3ZfbT3Vx761vTx1898qVFYKYYARR/pOx89WjnA6ywTlYQpNVtzCQtAyk+lEbPXkV9jrPZWI/ZDGmN6bDa2SmAkGwCbYwUCPoI/k7GU=', 'base64')
}

var leavesMagnetParsed = {
  infoHash: 'd2474e86c95b19b8bcfdb92bc12c9d44667cfa36',
  infoHashBuffer: Buffer.from('d2474e86c95b19b8bcfdb92bc12c9d44667cfa36', 'hex'),
  name: 'Leaves of Grass by Walt Whitman.epub',
  announce: [],
  urlList: [],
  files: [
    {
      path: 'Leaves of Grass by Walt Whitman.epub',
      name: 'Leaves of Grass by Walt Whitman.epub',
      length: 362017,
      offset: 0
    }
  ],
  length: 362017,
  pieceLength: 16384,
  lastPieceLength: 1569,
  pieces: [
    '1f9c3f59beec079715ec53324bde8569e4a0b4eb',
    'ec42307d4ce5557b5d3964c5ef55d354cf4a6ecc',
    '7bf1bcaf79d11fa5e0be06593c8faafc0c2ba2cf',
    '76d71c5b01526b23007f9e9929beafc5151e6511',
    '0931a1b44c21bf1e68b9138f90495e690dbc55f5',
    '72e4c2944cbacf26e6b3ae8a7229d88aafa05f61',
    'eaae6abf3f07cb6db9677cc6aded4dd3985e4586',
    '27567fa7639f065f71b18954304aca6366729e0b',
    '4773d77ae80caa96a524804dfe4b9bd3deaef999',
    'c9dd51027467519d5eb2561ae2cc01467de5f643',
    '0a60bcba24797692efa8770d23df0a830d91cb35',
    'b3407a88baa0590dc8c9aa6a120f274367dcd867',
    'e88e8338c572a06e3c801b29f519df532b3e76f6',
    '70cf6aee53107f3d39378483f69cf80fa568b1ea',
    'c53b506159e988d8bc16922d125d77d803d652c3',
    'ca3070c16eed9172ab506d20e522ea3f1ab674b3',
    'f923d76fe8f44ff32e372c3b376564c6fb5f0dbe',
    '52164f03629fd1322636babb2c014b7dae582da4',
    '1363965261e6ce12b43701f0a8c9ed1520a70eba',
    '004400a267765f6d3dd5c7beb5bd3c75f3df2a54',
    '560a61801147fa4ec7cf568e703acb04e5610a4d',
    '56dcc242d03293e9446cf5e457d8eb3d9588fd90',
    'c698de9b0dad92980906c026d8c1408fa08fe4ec'
  ],
  info: {
    length: 362017,
    name: Buffer.from('TGVhdmVzIG9mIEdyYXNzIGJ5IFdhbHQgV2hpdG1hbi5lcHVi', 'base64'),
    'piece length': 16384,
    pieces: Buffer.from('H5w/Wb7sB5cV7FMyS96FaeSgtOvsQjB9TOVVe105ZMXvVdNUz0puzHvxvK950R+l4L4GWTyPqvwMK6LPdtccWwFSayMAf56ZKb6vxRUeZREJMaG0TCG/Hmi5E4+QSV5pDbxV9XLkwpRMus8m5rOuinIp2IqvoF9h6q5qvz8Hy225Z3zGre1N05heRYYnVn+nY58GX3GxiVQwSspjZnKeC0dz13roDKqWpSSATf5Lm9PervmZyd1RAnRnUZ1eslYa4swBRn3l9kMKYLy6JHl2ku+odw0j3wqDDZHLNbNAeoi6oFkNyMmqahIPJ0Nn3Nhn6I6DOMVyoG48gBsp9RnfUys+dvZwz2ruUxB/PTk3hIP2nPgPpWix6sU7UGFZ6YjYvBaSLRJdd9gD1lLDyjBwwW7tkXKrUG0g5SLqPxq2dLP5I9dv6PRP8y43LDs3ZWTG+18NvlIWTwNin9EyJja6uywBS32uWC2kE2OWUmHmzhK0NwHwqMntFSCnDroARACiZ3ZfbT3Vx761vTx1898qVFYKYYARR/pOx89WjnA6ywTlYQpNVtzCQtAyk+lEbPXkV9jrPZWI/ZDGmN6bDa2SmAkGwCbYwUCPoI/k7A==', 'base64')
  },
  infoBuffer: Buffer.from('ZDY6bGVuZ3RoaTM2MjAxN2U0Om5hbWUzNjpMZWF2ZXMgb2YgR3Jhc3MgYnkgV2FsdCBXaGl0bWFuLmVwdWIxMjpwaWVjZSBsZW5ndGhpMTYzODRlNjpwaWVjZXM0NjA6H5w/Wb7sB5cV7FMyS96FaeSgtOvsQjB9TOVVe105ZMXvVdNUz0puzHvxvK950R+l4L4GWTyPqvwMK6LPdtccWwFSayMAf56ZKb6vxRUeZREJMaG0TCG/Hmi5E4+QSV5pDbxV9XLkwpRMus8m5rOuinIp2IqvoF9h6q5qvz8Hy225Z3zGre1N05heRYYnVn+nY58GX3GxiVQwSspjZnKeC0dz13roDKqWpSSATf5Lm9PervmZyd1RAnRnUZ1eslYa4swBRn3l9kMKYLy6JHl2ku+odw0j3wqDDZHLNbNAeoi6oFkNyMmqahIPJ0Nn3Nhn6I6DOMVyoG48gBsp9RnfUys+dvZwz2ruUxB/PTk3hIP2nPgPpWix6sU7UGFZ6YjYvBaSLRJdd9gD1lLDyjBwwW7tkXKrUG0g5SLqPxq2dLP5I9dv6PRP8y43LDs3ZWTG+18NvlIWTwNin9EyJja6uywBS32uWC2kE2OWUmHmzhK0NwHwqMntFSCnDroARACiZ3ZfbT3Vx761vTx1898qVFYKYYARR/pOx89WjnA6ywTlYQpNVtzCQtAyk+lEbPXkV9jrPZWI/ZDGmN6bDa2SmAkGwCbYwUCPoI/k7GU=', 'base64')
}

var numbersParsed = {
  infoHash: '89d97c2261a21b040cf11caa661a3ba7233bb7e6',
  infoHashBuffer: Buffer.from('89d97c2261a21b040cf11caa661a3ba7233bb7e6', 'hex'),
  name: 'numbers',
  created: new Date('+047910-02-15T17:44:02.000Z'),
  announce: [],
  urlList: [],
  files: [
    {
      path: 'numbers/1.txt',
      name: '1.txt',
      length: 1,
      offset: 0
    },
    {
      path: 'numbers/2.txt',
      name: '2.txt',
      length: 2,
      offset: 1
    },
    {
      path: 'numbers/3.txt',
      name: '3.txt',
      length: 3,
      offset: 3
    }
  ],
  length: 6,
  pieceLength: 16384,
  lastPieceLength: 6,
  pieces: [
    '1f74648e50a6a6708ec54ab327a163d5536b7ced'
  ],
  info: {
    files: [
      {
        length: 1,
        path: [ Buffer.from('1.txt') ]
      },
      {
        length: 2,
        path: [ Buffer.from('2.txt') ]
      },
      {
        length: 3,
        path: [ Buffer.from('3.txt') ]
      }
    ],
    name: Buffer.from('bnVtYmVycw==', 'base64'),
    'piece length': 16384,
    pieces: Buffer.from('H3RkjlCmpnCOxUqzJ6Fj1VNrfO0=', 'base64')
  },
  infoBuffer: Buffer.from('ZDU6ZmlsZXNsZDY6bGVuZ3RoaTFlNDpwYXRobDU6MS50eHRlZWQ2Omxlbmd0aGkyZTQ6cGF0aGw1OjIudHh0ZWVkNjpsZW5ndGhpM2U0OnBhdGhsNTozLnR4dGVlZTQ6bmFtZTc6bnVtYmVyczEyOnBpZWNlIGxlbmd0aGkxNjM4NGU2OnBpZWNlczIwOh90ZI5QpqZwjsVKsyehY9VTa3ztZQ==', 'base64')
}

test('parse single file torrent', function (t) {
  t.deepEquals(parseTorrentFile(fixtures.leaves.torrent), leavesParsed)
  t.end()
})

test('parse "torrent" from magnet metadata protocol', function (t) {
  t.deepEquals(parseTorrentFile(fixtures.leavesMetadata.torrent), leavesMagnetParsed)
  t.end()
})

test('parse multiple file torrent', function (t) {
  t.deepEquals(parseTorrentFile(fixtures.numbers.torrent), numbersParsed)
  t.end()
})

test('parse torrent from object', function (t) {
  var torrent = bencode.decode(fixtures.numbers.torrent)
  t.deepEquals(parseTorrentFile(torrent), numbersParsed)
  t.end()
})
