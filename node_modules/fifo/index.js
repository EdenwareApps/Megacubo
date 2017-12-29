var Node = function(list, val) {
	this.prev = this.next = this;
	this.value = val;
	this.list = list;
};

Node.prototype.link = function(next) {
	this.next = next;
	next.prev = this;
	return next;
};

var FIFO = function() {
	if (!(this instanceof FIFO)) return new FIFO();
	this.node = null;
	this.length = 0;
};

FIFO.prototype.set = function(node, value) {
	if (!node || node.list !== this) return null;
	node.value = value;
	return node;
};

FIFO.prototype.get = function(node) {
	if (!node || node.list !== this) return null;
	return node.value;
};

FIFO.prototype.remove = function(node) {
	if (!node || node.list !== this) return null;
	this.length--;
	node.list = null;
	node.prev.link(node.next);
	if (node === this.node) this.node = node.next === node ? null : node.next;
	return node.value;
};

FIFO.prototype.unshift = function(value) {
	return this.node = this.push(value);
};

FIFO.prototype.push = function(value) {
	var node = new Node(this, value);
	this.length++;
	if (!this.node) return this.node = node;
	this.node.prev.link(node);
	node.link(this.node);
	return node;
};

FIFO.prototype.first = function() {
	return this.node && this.node.value;
};

FIFO.prototype.last = function() {
	return this.node && this.node.prev.value;
};

FIFO.prototype.shift = function() {
	return this.node && this.remove(this.node);
};

FIFO.prototype.pop = function() {
	return this.node && this.remove(this.node.prev);
};

module.exports = FIFO;