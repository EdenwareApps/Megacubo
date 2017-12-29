var fs = require('fs')
var parseTorrentFile = require('../')
var path = require('path')
var test = require('tape')

var bitloveIntro = fs.readFileSync(path.join(__dirname, 'torrents/bitlove-intro.torrent'))

var bitloveParsed = {
  infoHash: '4cb67059ed6bd08362da625b3ae77f6f4a075705',
  infoHashBuffer: Buffer.from('4cb67059ed6bd08362da625b3ae77f6f4a075705', 'hex'),
  name: 'bl001-introduction.webm',
  announce: [
    'http://t.bitlove.org/announce'
  ],
  urlList: [
    'http://spaceboyz.net/~astro/bitlove-show/bl001-introduction.webm'
  ],
  files: [
    {
      'path': 'bl001-introduction.webm',
      'name': 'bl001-introduction.webm',
      'length': 19211729,
      'offset': 0
    }
  ],
  length: 19211729,
  pieceLength: 1048576,
  lastPieceLength: 337361,
  pieces: [
    '90a75dcd4e88d287c7ac5599c108f6036c13c4ce',
    '1ef5468bdff9a4466ad4e446477981cb67d07933',
    '1fa911a663451280953edb723e67611957dc0fe1',
    '2abad6066e29c723f01b0908ec30e0e737514a88',
    '55afda8e14a45e7f797eb47b82b2d0a3b2ca5f36',
    '7e1f49593515ca1b93ad01c3ee050e35f04f5c2e',
    '15b9abb123228002cca6a7d88fc9fc99d24583e1',
    '32704a020d2f121bfc612b7627cd92e2b39ad43c',
    '35bebb2888f7143c2966bb4d5f74e0b875825856',
    '6875f4bb1a9fa631ee35bcd7469b1e8ff37d65a2',
    'cbbeeeadc148ed681b699e88a940f796f51c0915',
    'c69121c81d85055678bf198bb29fc9e504ed8c7f',
    '7e3863c6e1c6a8c824569f1cc0950498dceb03c4',
    'ab4e77dade5f54246559c40915b700a4f734cee0',
    '92c47be2d397afbf06a9e9a573a63a3c683d2aa5',
    '01ad212a1495208b7ffbb173ce5782291695652b',
    '3f6233bf4ea3649c7799a1848f06cade97987525',
    'db37c799e45bd02fc25eacc12e18c6c11b4da3fb',
    '4c73df9307b3939fec3cd5f0df179c50a49c6ca3'
  ],
  info: {
    length: 19211729,
    name: Buffer.from('YmwwMDEtaW50cm9kdWN0aW9uLndlYm0=', 'base64'),
    'piece length': 1048576,
    pieces: Buffer.from('kKddzU6I0ofHrFWZwQj2A2wTxM4e9UaL3/mkRmrU5EZHeYHLZ9B5Mx+pEaZjRRKAlT7bcj5nYRlX3A/hKrrWBm4pxyPwGwkI7DDg5zdRSohVr9qOFKRef3l+tHuCstCjsspfNn4fSVk1Fcobk60Bw+4FDjXwT1wuFbmrsSMigALMpqfYj8n8mdJFg+EycEoCDS8SG/xhK3YnzZLis5rUPDW+uyiI9xQ8KWa7TV904Lh1glhWaHX0uxqfpjHuNbzXRpsej/N9ZaLLvu6twUjtaBtpnoipQPeW9RwJFcaRIcgdhQVWeL8Zi7KfyeUE7Yx/fjhjxuHGqMgkVp8cwJUEmNzrA8SrTnfa3l9UJGVZxAkVtwCk9zTO4JLEe+LTl6+/BqnppXOmOjxoPSqlAa0hKhSVIIt/+7FzzleCKRaVZSs/YjO/TqNknHeZoYSPBsrel5h1Jds3x5nkW9Avwl6swS4YxsEbTaP7THPfkwezk5/sPNXw3xecUKScbKM=', 'base64')
  },
  infoBuffer: Buffer.from('ZDY6bGVuZ3RoaTE5MjExNzI5ZTQ6bmFtZTIzOmJsMDAxLWludHJvZHVjdGlvbi53ZWJtMTI6cGllY2UgbGVuZ3RoaTEwNDg1NzZlNjpwaWVjZXMzODA6kKddzU6I0ofHrFWZwQj2A2wTxM4e9UaL3/mkRmrU5EZHeYHLZ9B5Mx+pEaZjRRKAlT7bcj5nYRlX3A/hKrrWBm4pxyPwGwkI7DDg5zdRSohVr9qOFKRef3l+tHuCstCjsspfNn4fSVk1Fcobk60Bw+4FDjXwT1wuFbmrsSMigALMpqfYj8n8mdJFg+EycEoCDS8SG/xhK3YnzZLis5rUPDW+uyiI9xQ8KWa7TV904Lh1glhWaHX0uxqfpjHuNbzXRpsej/N9ZaLLvu6twUjtaBtpnoipQPeW9RwJFcaRIcgdhQVWeL8Zi7KfyeUE7Yx/fjhjxuHGqMgkVp8cwJUEmNzrA8SrTnfa3l9UJGVZxAkVtwCk9zTO4JLEe+LTl6+/BqnppXOmOjxoPSqlAa0hKhSVIIt/+7FzzleCKRaVZSs/YjO/TqNknHeZoYSPBsrel5h1Jds3x5nkW9Avwl6swS4YxsEbTaP7THPfkwezk5/sPNXw3xecUKScbKNl', 'base64')
}

test('parse torrent with no announce-list', function (t) {
  t.deepEquals(parseTorrentFile(bitloveIntro), bitloveParsed)
  t.end()
})
