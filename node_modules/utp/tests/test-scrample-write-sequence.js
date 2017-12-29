require('./scrample');

var utp = require('../index');
var assert = require('assert');
var max = 10;

utp.createServer(function(socket) {
	var prev = 0;
	socket.on('data', function(data) {
		assert(''+(prev++) === data.toString());
		socket.write(data);
		if (prev === max) socket.end();
	});
}).listen(53454);

var socket = utp.connect(53454);
var prev = 0;

for (var i = 0; i < max; i++) {
	socket.write(''+i);
}

socket.on('data', function(data) {
	assert(''+(prev++) === data.toString());
});
socket.on('end', function() {
	process.exit(0);
});

setTimeout(process.exit.bind(process, 1), 15000);