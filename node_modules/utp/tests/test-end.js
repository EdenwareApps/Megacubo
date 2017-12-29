var utp = require('../index');
var assert = require('assert');

var ended = false;

utp.createServer(function(socket) {
	socket.resume();
	socket.on('end', function() {
		ended = true;
		socket.end();
	});
}).listen(53454);

var socket = utp.connect(53454);

socket.resume();
socket.on('end', function() {
	assert(ended);
	process.exit(0);
});
socket.end();

setTimeout(process.exit.bind(process, 1), 5000);