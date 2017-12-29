require('./scrample');

var utp = require('../index');
var assert = require('assert');

var big = new Buffer(10*1024);
big.fill(1);

utp.createServer(function(socket) {
	socket.on('data', function(data) {
		socket.write(data);
	});
	socket.on('end', function() {
		socket.end();
	});
}).listen(53454);

var socket = utp.connect(53454);
var recv = 0;

socket.write(big);
socket.end();

socket.on('data', function(data) {
	recv += data.length;
	console.log(recv);
});
socket.on('end', function() {
	assert(recv === big.length);
	process.exit(0);
});

setTimeout(process.exit.bind(process, 1), 15000);