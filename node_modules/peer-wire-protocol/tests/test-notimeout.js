var assert = require('assert');
var wireProtocol = require('../index');
var wire = wireProtocol();

var timeouts = 0;

wire.pipe(wire);
wire.setTimeout(1000);

wire.handshake(new Buffer('01234567890123456789'), new Buffer('12345678901234567890'));
wire.unchoke();

wire.on('request', function(i, offset, length, callback) {
	callback(null, new Buffer('hello world'));
});

wire.on('unchoke', function() {
	var requests = 0;

	wire.request(0, 0, 11, function(err) {
		assert.ok(!err);
		assert.ok(++requests === 1);
	});

	wire.request(0, 0, 11, function(err) {
		assert.ok(!err);
		assert.ok(++requests === 2);
	});

	wire.request(0, 0, 11, function(err) {
		assert.ok(!err);
		assert.ok(++requests === 3);
		clearTimeout(timeout);
	});
});

wire.on('timeout', function() {
	assert.ok(false);
});

var timeout = setTimeout(function() {
	process.exit(1);
}, 5000);