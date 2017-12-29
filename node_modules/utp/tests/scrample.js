var on = require('dgram').Socket.prototype.on;

var LOSS_FACTOR = 5;
var SHUFFLE_INTERVAL = 50;

require('dgram').Socket.prototype.on = function(type, listener) {
	var fn = listener;

	if (type === 'message') {
		var i = 0;
		fn = function(message, rinfo) {
			var action = listener.bind(this, message, rinfo);

			if ((i++ % LOSS_FACTOR) === 0) return;
			setTimeout(action, (SHUFFLE_INTERVAL * Math.random()) | 0);
		};
	}

	return on.call(this, type, fn);
};
