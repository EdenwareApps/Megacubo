# utp

utp (micro transport protocol) implementation in node.
It is available through npm

	npm install utp

## What is utp?

utp (micro transport protocol) is a network protocol similar to tcp that runs on top of udp.
Since it build on top of udp it can provide great peer to peer connectivity
through techniques like hole punching and similar while still providing a stream interface.
It is currently the main network protocol powering bittorrent.

## BEWARE BEWARE BEWARE

*This module is a work in progress! So beware of dragons!*

## Usage

utp has the same interface as the net module in node.

``` js
var utp = require('utp');

var server = utp.createServer(function(socket) {
	console.log('new connection!');
	client.on('data', function(data) {
		console.log('client says '+data);
	});
});

server.listen(10000, function() {
	var client = utp.connect(10000, 'localhost');

	client.write('hello world');
});
```

`server.listen()` also accepts a udp socket to listen on instead of a port.


## License

MIT