var fs = require('fs')
var parseTorrent = require('../')
var test = require('tape')

var leaves = fs.readFileSync(__dirname + '/torrents/leaves.torrent')
var leavesMagnet = fs.readFileSync(__dirname + '/torrents/leaves-magnet.torrent')
var pride = fs.readFileSync(__dirname + '/torrents/pride.torrent')
var leavesCorrupt = fs.readFileSync(__dirname + '/torrents/leaves-corrupt.torrent')
var leavesUrlList = fs.readFileSync(__dirname + '/torrents/leaves-url-list.torrent')

var leavesParsed = {
  infoHash: 'd2474e86c95b19b8bcfdb92bc12c9d44667cfa36',
  name: 'Leaves of Grass by Walt Whitman.epub',
  announce: [
    'http://tracker.thepiratebay.org/announce',
    'udp://tracker.openbittorrent.com:80',
    'udp://tracker.ccc.de:80',
    'udp://tracker.publicbt.com:80',
    'udp://fr33domtracker.h33t.com:3310/announce',
    'http://tracker.bittorrent.am/announce'
  ]
}

var leavesMagnetParsed = {
  infoHash: 'd2474e86c95b19b8bcfdb92bc12c9d44667cfa36',
  name: 'Leaves of Grass by Walt Whitman.epub',
  announce: []
}

var prideParsed = {
  infoHash: '455a2295b558ac64e0348fb0c61f433224484908',
  name: 'PRIDE AND PREJUDICE  - Jane Austen',
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
  ]
}

test('parse single file torrent', function (t) {
  var parsed = parseTorrent(leaves)
  t.equal(parsed.infoHash, leavesParsed.infoHash)
  t.equal(parsed.name, leavesParsed.name)
  t.deepEquals(parsed.announce, leavesParsed.announce)
  t.end()
})

test('parse "torrent" from magnet metadata protocol', function (t) {
  var parsed = parseTorrent(leavesMagnet)
  t.equal(parsed.infoHash, leavesMagnetParsed.infoHash)
  t.equal(parsed.name, leavesMagnetParsed.name)
  t.deepEquals(parsed.announce, leavesMagnetParsed.announce)
  t.end()
})

test('parse multiple file torrent', function (t) {
  var parsed = parseTorrent(pride)
  t.equal(parsed.infoHash, prideParsed.infoHash)
  t.equal(parsed.name, prideParsed.name)
  t.deepEquals(parsed.announce, prideParsed.announce)
  t.end()
})

test('torrent file missing `name` field throws', function (t) {
  t.throws(function () {
    parseTorrent(leavesCorrupt)
  })
  t.end()
})

test('parse url-list for webseed support', function (t) {
  var torrent = parseTorrent(leavesUrlList)
  t.deepEqual(torrent.urlList, [ 'http://www2.hn.psu.edu/faculty/jmanis/whitman/leaves-of-grass6x9.pdf' ])
  t.end()
})
