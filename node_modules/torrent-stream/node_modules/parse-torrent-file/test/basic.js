var bencode = require('bencode')
var fs = require('fs')
var parseTorrent = require('../')
var test = require('tape')

var leaves = fs.readFileSync(__dirname + '/torrents/leaves.torrent')
var leavesMagnet = fs.readFileSync(__dirname + '/torrents/leaves-magnet.torrent')
var pride = fs.readFileSync(__dirname + '/torrents/pride.torrent')

var leavesParsed = {
  infoHash: 'd2474e86c95b19b8bcfdb92bc12c9d44667cfa36',
  name: 'Leaves of Grass by Walt Whitman.epub',
  private: false,
  created: new Date('Thu Aug 01 2013 06:27:46 GMT-0700 (PDT)'),
  announce: [
    'http://tracker.thepiratebay.org/announce',
    'udp://tracker.openbittorrent.com:80',
    'udp://tracker.ccc.de:80',
    'udp://tracker.publicbt.com:80',
    'udp://fr33domtracker.h33t.com:3310/announce',
    'http://tracker.bittorrent.am/announce'
  ],
  announceList: [
    ['http://tracker.thepiratebay.org/announce'],
    ['udp://tracker.openbittorrent.com:80'],
    ['udp://tracker.ccc.de:80'],
    ['udp://tracker.publicbt.com:80'],
    ['udp://fr33domtracker.h33t.com:3310/announce', 'http://tracker.bittorrent.am/announce']
  ],
  comment: 'Downloaded from http://TheTorrent.org',
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
    name: new Buffer('TGVhdmVzIG9mIEdyYXNzIGJ5IFdhbHQgV2hpdG1hbi5lcHVi', 'base64'),
    'piece length': 16384,
    pieces: new Buffer('H5w/Wb7sB5cV7FMyS96FaeSgtOvsQjB9TOVVe105ZMXvVdNUz0puzHvxvK950R+l4L4GWTyPqvwMK6LPdtccWwFSayMAf56ZKb6vxRUeZREJMaG0TCG/Hmi5E4+QSV5pDbxV9XLkwpRMus8m5rOuinIp2IqvoF9h6q5qvz8Hy225Z3zGre1N05heRYYnVn+nY58GX3GxiVQwSspjZnKeC0dz13roDKqWpSSATf5Lm9PervmZyd1RAnRnUZ1eslYa4swBRn3l9kMKYLy6JHl2ku+odw0j3wqDDZHLNbNAeoi6oFkNyMmqahIPJ0Nn3Nhn6I6DOMVyoG48gBsp9RnfUys+dvZwz2ruUxB/PTk3hIP2nPgPpWix6sU7UGFZ6YjYvBaSLRJdd9gD1lLDyjBwwW7tkXKrUG0g5SLqPxq2dLP5I9dv6PRP8y43LDs3ZWTG+18NvlIWTwNin9EyJja6uywBS32uWC2kE2OWUmHmzhK0NwHwqMntFSCnDroARACiZ3ZfbT3Vx761vTx1898qVFYKYYARR/pOx89WjnA6ywTlYQpNVtzCQtAyk+lEbPXkV9jrPZWI/ZDGmN6bDa2SmAkGwCbYwUCPoI/k7A==', 'base64')
  },
  infoBuffer: new Buffer('ZDY6bGVuZ3RoaTM2MjAxN2U0Om5hbWUzNjpMZWF2ZXMgb2YgR3Jhc3MgYnkgV2FsdCBXaGl0bWFuLmVwdWIxMjpwaWVjZSBsZW5ndGhpMTYzODRlNjpwaWVjZXM0NjA6H5w/Wb7sB5cV7FMyS96FaeSgtOvsQjB9TOVVe105ZMXvVdNUz0puzHvxvK950R+l4L4GWTyPqvwMK6LPdtccWwFSayMAf56ZKb6vxRUeZREJMaG0TCG/Hmi5E4+QSV5pDbxV9XLkwpRMus8m5rOuinIp2IqvoF9h6q5qvz8Hy225Z3zGre1N05heRYYnVn+nY58GX3GxiVQwSspjZnKeC0dz13roDKqWpSSATf5Lm9PervmZyd1RAnRnUZ1eslYa4swBRn3l9kMKYLy6JHl2ku+odw0j3wqDDZHLNbNAeoi6oFkNyMmqahIPJ0Nn3Nhn6I6DOMVyoG48gBsp9RnfUys+dvZwz2ruUxB/PTk3hIP2nPgPpWix6sU7UGFZ6YjYvBaSLRJdd9gD1lLDyjBwwW7tkXKrUG0g5SLqPxq2dLP5I9dv6PRP8y43LDs3ZWTG+18NvlIWTwNin9EyJja6uywBS32uWC2kE2OWUmHmzhK0NwHwqMntFSCnDroARACiZ3ZfbT3Vx761vTx1898qVFYKYYARR/pOx89WjnA6ywTlYQpNVtzCQtAyk+lEbPXkV9jrPZWI/ZDGmN6bDa2SmAkGwCbYwUCPoI/k7GU=', 'base64')
}

var leavesMagnetParsed = {
  infoHash: 'd2474e86c95b19b8bcfdb92bc12c9d44667cfa36',
  name: 'Leaves of Grass by Walt Whitman.epub',
  private: false,
  announce: [],
  announceList: [],
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
    name: new Buffer('TGVhdmVzIG9mIEdyYXNzIGJ5IFdhbHQgV2hpdG1hbi5lcHVi', 'base64'),
    'piece length': 16384,
    pieces: new Buffer('H5w/Wb7sB5cV7FMyS96FaeSgtOvsQjB9TOVVe105ZMXvVdNUz0puzHvxvK950R+l4L4GWTyPqvwMK6LPdtccWwFSayMAf56ZKb6vxRUeZREJMaG0TCG/Hmi5E4+QSV5pDbxV9XLkwpRMus8m5rOuinIp2IqvoF9h6q5qvz8Hy225Z3zGre1N05heRYYnVn+nY58GX3GxiVQwSspjZnKeC0dz13roDKqWpSSATf5Lm9PervmZyd1RAnRnUZ1eslYa4swBRn3l9kMKYLy6JHl2ku+odw0j3wqDDZHLNbNAeoi6oFkNyMmqahIPJ0Nn3Nhn6I6DOMVyoG48gBsp9RnfUys+dvZwz2ruUxB/PTk3hIP2nPgPpWix6sU7UGFZ6YjYvBaSLRJdd9gD1lLDyjBwwW7tkXKrUG0g5SLqPxq2dLP5I9dv6PRP8y43LDs3ZWTG+18NvlIWTwNin9EyJja6uywBS32uWC2kE2OWUmHmzhK0NwHwqMntFSCnDroARACiZ3ZfbT3Vx761vTx1898qVFYKYYARR/pOx89WjnA6ywTlYQpNVtzCQtAyk+lEbPXkV9jrPZWI/ZDGmN6bDa2SmAkGwCbYwUCPoI/k7A==', 'base64')
  },
  infoBuffer: new Buffer('ZDY6bGVuZ3RoaTM2MjAxN2U0Om5hbWUzNjpMZWF2ZXMgb2YgR3Jhc3MgYnkgV2FsdCBXaGl0bWFuLmVwdWIxMjpwaWVjZSBsZW5ndGhpMTYzODRlNjpwaWVjZXM0NjA6H5w/Wb7sB5cV7FMyS96FaeSgtOvsQjB9TOVVe105ZMXvVdNUz0puzHvxvK950R+l4L4GWTyPqvwMK6LPdtccWwFSayMAf56ZKb6vxRUeZREJMaG0TCG/Hmi5E4+QSV5pDbxV9XLkwpRMus8m5rOuinIp2IqvoF9h6q5qvz8Hy225Z3zGre1N05heRYYnVn+nY58GX3GxiVQwSspjZnKeC0dz13roDKqWpSSATf5Lm9PervmZyd1RAnRnUZ1eslYa4swBRn3l9kMKYLy6JHl2ku+odw0j3wqDDZHLNbNAeoi6oFkNyMmqahIPJ0Nn3Nhn6I6DOMVyoG48gBsp9RnfUys+dvZwz2ruUxB/PTk3hIP2nPgPpWix6sU7UGFZ6YjYvBaSLRJdd9gD1lLDyjBwwW7tkXKrUG0g5SLqPxq2dLP5I9dv6PRP8y43LDs3ZWTG+18NvlIWTwNin9EyJja6uywBS32uWC2kE2OWUmHmzhK0NwHwqMntFSCnDroARACiZ3ZfbT3Vx761vTx1898qVFYKYYARR/pOx89WjnA6ywTlYQpNVtzCQtAyk+lEbPXkV9jrPZWI/ZDGmN6bDa2SmAkGwCbYwUCPoI/k7GU=', 'base64')
}

var prideParsed = {
  infoHash: '455a2295b558ac64e0348fb0c61f433224484908',
  name: 'PRIDE AND PREJUDICE  - Jane Austen',
  private: false,
  created: new Date('Mon Jul 22 2013 10:33:19 GMT-0700 (PDT)'),
  announce: [
    'http://tracker.thepiratebay.org/announce',
    'udp://tracker.openbittorrent.com:80',
    'udp://tracker.ccc.de:80',
    'udp://tracker.publicbt.com:80',
    'http://tracker.tfile.me/announce',
    'http://tracker.marshyonline.net/announce',
    'http://tracker.ex.ua/announce',
    'http://i.bandito.org/announce',
    'http://greenlietracker.appspot.com/announce',
    'http://exodus.desync.com:6969/announce',
    'http://calu-atrack.appspot.com/announce',
    'http://calu-atrack.appspot.com.nyud.net/announce',
    'http://bt.poletracker.org:2710/announce',
    'http://bigfoot1942.sektori.org:6969/announce',
    'http://announce.opensharing.org:2710/announce',
    'http://94.228.192.98.nyud.net/announce',
    'http://bt.careland.com.cn:6969/announce',
    'http://e180.php5.cz/announce',
    'http://beta.mytracker.me:6969/announce',
    'http://tracker.metin2.com.br:6969/announce',
    'http://tracker1.wasabii.com.tw:6969/announce',
    'http://retracker.perm.ertelecom.ru/announce',
    'http://fr33dom.h33t.com:3310/announce',
    'http://exodus.desync.com/announce',
    'http://bt.eutorrents.com/announce.php',
    'http://retracker.hq.ertelecom.ru/announce',
    'http://announce.torrentsmd.com:8080/announce',
    'http://announce.torrentsmd.com:8080/announce.php',
    'http://www.h33t.com:3310/announce',
    'http://tracker.yify-torrents.com/announce',
    'http://announce.torrentsmd.com:6969/announce',
    'http://fr33domtracker.h33t.com:3310/announce'
  ],
  announceList: [
    ['http://tracker.thepiratebay.org/announce'],
    ['udp://tracker.openbittorrent.com:80'],
    ['udp://tracker.ccc.de:80'],
    ['udp://tracker.publicbt.com:80'],
    ['http://tracker.tfile.me/announce'],
    ['http://tracker.marshyonline.net/announce'],
    ['http://tracker.ex.ua/announce'],
    ['http://i.bandito.org/announce'],
    ['http://greenlietracker.appspot.com/announce'],
    ['http://exodus.desync.com:6969/announce'],
    ['http://calu-atrack.appspot.com/announce'],
    ['http://calu-atrack.appspot.com.nyud.net/announce'],
    ['http://bt.poletracker.org:2710/announce'],
    ['http://bigfoot1942.sektori.org:6969/announce'],
    ['http://announce.opensharing.org:2710/announce'],
    ['http://94.228.192.98.nyud.net/announce'],
    ['http://bt.careland.com.cn:6969/announce'],
    ['http://e180.php5.cz/announce'],
    ['http://beta.mytracker.me:6969/announce'],
    ['http://tracker.metin2.com.br:6969/announce'],
    ['http://tracker1.wasabii.com.tw:6969/announce'],
    ['http://retracker.perm.ertelecom.ru/announce'],
    ['http://fr33dom.h33t.com:3310/announce'],
    ['http://exodus.desync.com/announce'],
    ['http://bt.eutorrents.com/announce.php'],
    ['http://retracker.hq.ertelecom.ru/announce'],
    ['http://announce.torrentsmd.com:8080/announce'],
    ['http://announce.torrentsmd.com:8080/announce.php'],
    ['http://www.h33t.com:3310/announce'],
    ['http://tracker.yify-torrents.com/announce'],
    ['http://announce.torrentsmd.com:6969/announce'],
    ['http://fr33domtracker.h33t.com:3310/announce']
  ],
  comment: 'Torrent downloaded from http://thepiratebay.sx',
  urlList: [],
  files: [
    {
      path: 'PRIDE AND PREJUDICE  - Jane Austen/Pride_and_Prejudice.pdf',
      name: 'Pride_and_Prejudice.pdf',
      length: 690450,
      offset: 0
    },
    {
      path: 'PRIDE AND PREJUDICE  - Jane Austen/Pride_and_Prejudice.mobi',
      name: 'Pride_and_Prejudice.mobi',
      length: 487076,
      offset: 690450
    },
    {
      path: 'PRIDE AND PREJUDICE  - Jane Austen/Pride and Prejudice.epub',
      name: 'Pride and Prejudice.epub',
      length: 305164,
      offset: 1177526
    }
  ],
  length: 1482690,
  pieceLength: 16384,
  lastPieceLength: 8130,
  pieces: [
    '56e502dc06ce8e6bb439f7e0bac27e69842bc89c',
    'b8d12dbd775b2b8cc01e03b18432703435531da8',
    'c2426cffcfebda20636abd71f0f4b4767cee9c42',
    '45d6fa6fe69537a20c7af1842a00e1b5599e27f8',
    'dbcf01ae81a83d77853a4f71335b075d62adf748',
    '49c8529ec2bc518cbbb67eeb53fa40b0b455af33',
    '9409bff50cab58deecc989cff56660fe7bf6ff78',
    '769c5ad7bd22e471ec8386275d4da3b61e114df7',
    '92c02dc3038497340a7a51b63a1646a6f5b6288f',
    'eedc15ca2de41169daf767bf4766a0c48a5966aa',
    'cd2172f736be03d79691a9a0a4073cebe0957819',
    '7ba2dc9e5a0cdb3aea094d5b89199dc90bc6aee8',
    '406eb2a2a451092a05857abc5dca6b9adac483b7',
    '48e4858ba838f953d11bc769a72ba1498185a18e',
    '5cc7f7179555f1c0e5d98cd36076f0bbb2891d9e',
    '6a475614b6e47df47239bc9c70e2b94f62b6de69',
    '6a91e084f21f4717bbde75e4742215b09e82ed81',
    '58f7d3ce0d9d71d14bb54911ee260378fb23c1e6',
    'e544318d3d14ad816517a494fc66e70e1631dfc9',
    '6e5b77e5e7bb7c6d055702c8e6046561c0d49748',
    '6319dac948f9a4f80650ea084e247f6f9a0ba929',
    '7016da40784b71b9888eed73839590e04bfd525c',
    'd1107879a20033ba14c9086b48d317a6fea3f6f7',
    '4491619af6aed40dc773e246f97dc546dfa557d5',
    '63ddc93af5bd90f0fde853ff888b0482ac4bad9c',
    '10aece0d35ec2627d0147d555dd523535287f05b',
    '8adff2fce41765b268c007321cb858d3dbdb7401',
    '7b74e03aeb18dde2e43739510636ef49d0d1a7ff',
    '2f2ed0e7e11ac45706d5f8a5c4642bbef8026bc4',
    '0f8aef0414c32b52f7b0a8abbc15f4e7e1b59707',
    '385151aad082f239cbf85603c277fca0e1d04019',
    '31a1b5ac49f62f34369f6fc9e3788050830160c2',
    '3fe20c34e52a3c10eeb1ef3852a328e557e15e23',
    'b53d2714d5914f9e44863a58d2a293ad475c88ba',
    '4ec1ad0905996699550c74c673ef774f5047fb88',
    '1f70e15546078902e2fd2aa7cbfaad83a90a496b',
    '3ced819a489fbe0b5f6355ec3c99aeb8818b4ab6',
    'e9d5a31e93f9113103521d0df827346ac393c862',
    'e7f431bef64c987badacf6c649f415f533b48fd5',
    'd6616dadd23054cb833e37ec7b53a7ca5edf824a',
    'eaf416c6d92cb5d28aa710b7512249705e00d855',
    'cd4df4dfd9c843aeba9459775323e8d6c9d85f68',
    '4b07f3301f4746b714262a700cb6a9ef75e4b963',
    '016ca0197293b5bd2ac0abf7a57189415ef16726',
    'd0a31ef2261b60e239b3483ce5d2b736ad6cea22',
    'cd4d4f122f8d4b2e83804c6dedc95d334f499fde',
    '8c6bfb574c5691890d2b15b6ff5c18a9e9b99824',
    '374663cf669727acdbf78a4ebb8100a8a443a8c2',
    '5634ad15c8f0ab2437fe053d78a895073ee20b4c',
    '519556f2243d5fdba5e4820e8ac3a4219b8715ed',
    '2b5845bb45a460761630bf3a3865188a8febd2d4',
    '24e2c96360edf7b3e2a6b7603a79ac54e741c472',
    '39acaa42dd9a8d89660a8ec07ee6bf12194b5ae3',
    '9fae46b3494e33f8c5e1f61b10eedf69374dbefe',
    '899e83b4f5a847f5dbbc952f67ff77d6be082f96',
    'f573e4c764ef1f0f2f20b85a80629f7b15f882f7',
    '19f16563ca572f84b47533fa24c690c21f868b9f',
    'ee76bae1bd68e42bc39e7559163cec0a54bf7e8c',
    '7e67df4720f2a44262dbf89bb969e22e84a14f46',
    'b4f21fd71b9cd6f86db2deb567fe72ed98f7bc90',
    '877581cf6dad17060386b250342388784290223a',
    '1f1f9753f1de891165bb5291f7ac228dc98d9c2f',
    '880138dbb26828c9cd55316f186c0e8d0f7ff4f5',
    'd96a87ae5a6b316189d73f3adccbba8ce6321e5a',
    '6456e6fa11431d9c8e365c5c8202dbd69b8d243d',
    '6348e1f7ce157c7bdcd6d62bb0c69dffad4af25d',
    '61e7427baccfbba4b3d7e26e6e67f3ea543af9c0',
    'd8d17002beb969516cf84c92c0089ade049a7e22',
    '743da7ee2297fbca93a4e33abc6f00079f143244',
    '42ad48a49af42cc507ef375af9ee4848737b81f9',
    '051c3bbe2e6adb32c7271fdd0beea190fa22ae24',
    '938087e5c5d84b6a748476b99690b1aa372ed5fe',
    '5a0e6df6d5f20bbc0ea9175fbc2b273233f2b338',
    'a9b04ce62bd5507dca5ec86136cbb3aabeefefa4',
    '8fbff2d3bac5ecf14fc1622b5bf535401c1ed7bb',
    'b5c533ab1ff0e8ab855b7042d4e3c238955aa87d',
    '84c765700d2fc8d908f88ed4ae0fdf96d5157c30',
    '5b296e7112dc33e69aab3ab6e946a47fa389dac8',
    'b1842138abcbd0859b798bf14af9c7620a4c9a64',
    'c7936f8b8a87aa331095ec81666812d74a2ca7b4',
    '63c84813baae4716df51e67ed65e39e2cb19abec',
    'b930014eef7374e1bb67cc0e3f56e5231800d00d',
    'e1d31be6858ad8910710c772499679aac3dda880',
    'c321105c6a22aeb7c80d6965ca5b807b3ea98467',
    'd3ee411a555b9e8d34d12464807511486cb2b813',
    'edb466e215767db3b7a0dd285cdeda37dbffd1aa',
    'd69ae8ca54101173188b3ca983509c8da46ac580',
    'af38e2516f6e5e4129e0c5f9efe0ad556f08fc48',
    '696e1d36078c494bc67d7863bda8e861e1bc3045',
    '516d770312c870273cae8aa03dbb07ca7533b969',
    '405e29473fff065fa5807cd2e8953e48589a77c3'
  ],
  info: {
    files: [
      {
        length: 690450,
        path: [ new Buffer('Pride_and_Prejudice.pdf') ]
      },
      {
        length: 487076,
        path: [ new Buffer('Pride_and_Prejudice.mobi') ]
      },
      {
        length: 305164,
        path: [ new Buffer('Pride and Prejudice.epub') ]
      }
    ],
    name: new Buffer('UFJJREUgQU5EIFBSRUpVRElDRSAgLSBKYW5lIEF1c3Rlbg==', 'base64'),
    'piece length': 16384,
    pieces: new Buffer('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', 'base64')
  },
  infoBuffer: new Buffer('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', 'base64')
}

test('parse single file torrent', function (t) {
  t.deepEquals(parseTorrent(leaves), leavesParsed)
  t.end()
})

test('parse "torrent" from magnet metadata protocol', function (t) {
  t.deepEquals(parseTorrent(leavesMagnet), leavesMagnetParsed)
  t.end()
})

test('parse multiple file torrent', function (t) {
  t.deepEquals(parseTorrent(pride), prideParsed)
  t.end()
})

test('parse torrent from object', function (t) {
  var torrent = bencode.decode(pride)
  t.deepEquals(parseTorrent(torrent), prideParsed)
  t.end()
})
