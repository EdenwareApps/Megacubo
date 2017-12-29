var Cyclist = function(size) {
	if (!(this instanceof Cyclist)) return new Cyclist(size);
	this.mask = 0;
	this.values = [];
	this.indexes = [];
	if (size) this.fit(size);
};

Cyclist.prototype.__defineGetter__('size', function() {
	return this.mask + 1;
});

Cyclist.prototype.put = function(index, val) {
	var pos = index & this.mask;
	this.indexes[pos] = index;
	this.values[pos] = val;
};

Cyclist.prototype.get = function(index) {
	return this.values[index & this.mask];
};

Cyclist.prototype.del = function(index) {
	var pos = index & this.mask;
	var val = this.values[pos];
	this.indexes[pos] = this.values[pos] = undefined;
	return val;
};

Cyclist.prototype.fit = function(size) {
	if (size <= this.size) return;
	while (this.size < size) this.mask = 2 * (this.mask + 1) - 1;

	var values = this.values;
	var indexes = this.indexes;
	this.values = new Array(this.size);
	this.indexes = new Array(this.size);

	for (var i = 0; i < indexes.length; i++) {
		if (indexes[i] !== undefined) this.put(indexes[i], values[i]);
	}
};

module.exports = Cyclist;