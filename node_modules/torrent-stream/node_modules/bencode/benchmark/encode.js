var fs        = require( 'fs' )

var bencode     = require( '../' )
var bencoding   = require( 'bencoding' )
var dht_bencode = require( 'dht-bencode' )
var bncode      = require( 'bncode' )
var dht         = require( 'dht.js/lib/dht/bencode' )

var buffer = fs.readFileSync( __dirname + '/test.torrent' )
var object = bencode.decode( buffer )
var object_utf8 = bencode.decode( buffer, 'utf8' )
var object_ascii = bencode.decode( buffer, 'ascii' )
var object_binary = bencode.decode( buffer, 'binary' )

suite('encode buffer', function() {
    bench('bencode', function() {
        bencode.encode( object )
    })
    bench('bencoding', function() {
        bencoding.encode( object )
    })
    bench('dht_bencode', function() {
        dht_bencode.bencode( object )
    })
    bench('bncode', function() {
        bncode.encode( object )
    })
    bench('dht', function() {
        dht.encode( object )
    })
})

suite('encode utf8', function() {
    bench('bencode', function() {
        bencode.encode( object_utf8 )
    })
    bench('bencoding', function() {
        bencoding.encode( object_utf8 )
    })
    bench('dht_bencode', function() {
        dht_bencode.bencode( object_utf8 )
    })
    bench('bncode', function() {
        bncode.encode( object_utf8 )
    })
    bench('dht', function() {
        dht.encode( object_utf8 )
    })
})
suite('encode ascii', function() {
    bench('bencode', function() {
        bencode.encode( object_ascii )
    })
    bench('bencoding', function() {
        bencoding.encode( object_ascii )
    })
    bench('dht_bencode', function() {
        dht_bencode.bencode( object_ascii )
    })
    bench('bncode', function() {
        bncode.encode( object_ascii )
    })
    bench('dht', function() {
        dht.encode( object_ascii )
    })
})
suite('encode binary', function() {
    bench('bencode', function() {
        bencode.encode( object_binary )
    })
    bench('bencoding', function() {
        bencoding.encode( object_binary )
    })
    bench('dht_bencode', function() {
        dht_bencode.bencode( object_binary )
    })
    bench('bncode', function() {
        bncode.encode( object_binary )
    })
    bench('dht', function() {
        dht.encode( object_binary )
    })
})
