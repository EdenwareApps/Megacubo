var utp = require('../index');
var assert = require('assert');

var connected = false;

utp.createServer(function() {
	connected = true;
}).listen(53454);

var socket = utp.connect(53454);
socket.on('connect', function() {
	assert(connected);
	process.exit(0);
});

setTimeout(process.exit.bind(process, 1), 5000);