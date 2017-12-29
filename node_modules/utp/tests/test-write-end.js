var utp = require('../index');
var assert = require('assert');

var ended = false;
var dataed = false;

utp.createServer(function(socket) {
	socket.on('data', function(data) {
		assert(data.toString() === 'client');
		socket.write('server');
	});
	socket.on('end', function() {
		ended = true;
		socket.end();
	});
}).listen(53454);

var socket = utp.connect(53454);

socket.on('data', function(data) {
	assert(data.toString() === 'server');
	dataed = true;
});
socket.on('end', function() {
	assert(ended);
	assert(dataed);
	process.exit(0);
});
socket.write('client');
socket.end();

setTimeout(process.exit.bind(process, 1), 5000);