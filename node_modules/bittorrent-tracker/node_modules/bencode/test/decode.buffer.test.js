var test  = require('tape').test
var bencode = require('./lib.js')
var data    = require('./data.js')

test("bencode#decode(x)", function(t)  {

  t.test('should be able to decode an integer', function(t) {
    t.plan(2)
    t.equal(bencode.decode('i123e'), 123);
    t.equal(bencode.decode('i-123e'), -123);
  })

  t.test('should be able to decode a float (as int)', function(t) {
    t.plan(2)
    t.equal(bencode.decode('i12.3e'), 12);
    t.equal(bencode.decode('i-12.3e'), -12);
  })

  t.test('should be able to decode a string', function(t) {
    t.plan(2)
    t.deepEqual(bencode.decode('5:asdfe'), new Buffer('asdfe'));
    t.deepEqual(bencode.decode(data.binResultData.toString()), data.binStringData);
  })

  t.test('should be able to decode "binary keys"', function(t) {
    t.plan(1)
    t.ok(bencode.decode(data.binKeyData).files.hasOwnProperty(data.binKeyName));
  })

  t.test('should be able to decode a dictionary', function(t) {
    t.plan(3)
    t.deepEqual(
      bencode.decode( 'd3:cow3:moo4:spam4:eggse' ),
      {
        cow: new Buffer('moo'),
        spam: new Buffer('eggs')
      }
    )
    t.deepEqual(
      bencode.decode( 'd4:spaml1:a1:bee' ),
      { spam: [
        new Buffer('a'),
        new Buffer('b')
      ] }
    )
    t.deepEqual(
      bencode.decode( 'd9:publisher3:bob17:publisher-webpage15:www.example.com18:publisher.location4:homee'),
      {
        'publisher': new Buffer('bob'),
        'publisher-webpage': new Buffer('www.example.com'),
        'publisher.location': new Buffer('home')
      }
    )
  });

  t.test('should be able to decode a list', function(t) {
    t.plan(1)
    t.deepEqual(
      bencode.decode( 'l4:spam4:eggse'),
      [ new Buffer('spam'),
        new Buffer('eggs') ]
    )
  })
  t.test('should return the correct type', function(t) {
    t.plan(1)
    t.ok(Buffer.isBuffer(bencode.decode('4:öö')));
  })
  t.test('should be able to decode stuff in dicts (issue #12)', function(t) {
    t.plan(4)
    var someData = {
      string: 'Hello World',
      integer: 12345,
      dict: {
        key: 'This is a string within a dictionary'
      },
      list: [ 1, 2, 3, 4, 'string', 5, {} ]
    }
    var result = bencode.encode( someData )
    var dat = bencode.decode ( result )
    t.equal(dat.integer, 12345)
    t.deepEqual(dat.string, new Buffer("Hello World"))
    t.deepEqual(dat.dict.key, new Buffer("This is a string within a dictionary"))
    t.deepEqual(dat.list, [1, 2, 3, 4, new Buffer('string'), 5, {}])
  })
})
