require('./scrample');

var utp = require('../index');
var assert = require('assert');

utp.createServer(function(socket) {
	socket.on('data', function(data) {
		assert(data.toString() === 'client');
		socket.write('server');
	});
}).listen(53454);

var socket = utp.connect(53454);
socket.write('client');
socket.on('data', function(data) {
	assert(data.toString() === 'server');
	process.exit(0);
});

setTimeout(process.exit.bind(process, 1), 15000);