
var ip = require('ip')

function IPSet (start, end) {
  this.start = start
  this.end   = end
  this.max   = end
  this.depth = 1
  this.left  = null
  this.right = null
}

IPSet.prototype.add = function (start, end) {
  var d = start - this.start
  var update = false

  if (d === 0 && this.end < end) {
    this.end = end
    update = true
  } else if (d < 0) {
    if (this.left) {
      update = this.left.add(start, end)
      if (update) this._balance()
    } else {
      this.left = new IPSet(start, end)
      update = true
    }
  } else if (d > 0) {
    if (this.right) {
      update = this.right.add(start, end)
      if (update) this._balance()
    } else {
      this.right = new IPSet(start, end)
      update = true
    }
  }

  if (update) this._update()
  return update
}

IPSet.prototype.contains = function (addr) {
  var node = this
  while (node && !(addr >= node.start && addr <= node.end)) {
    if (node.left && node.left.max >= addr) node = node.left
    else node = node.right
  }
  return !!node
}

IPSet.prototype._balance = function () {
  var ldepth = this.left ? this.left.depth : 0
  var rdepth = this.right ? this.right.depth : 0

  if (ldepth > rdepth + 1) {
    var lldepth = this.left.left ? this.left.left.depth : 0
    var lrdepth = this.left.right ? this.left.right.depth : 0
    if (lldepth < lrdepth) this.left._rotateRR()
    this._rotateLL()
  } else if (ldepth + 1 < rdepth) {
    var rrdepth = this.right.right ? this.right.right.depth : 0
    var rldepth = this.right.left ? this.right.left.depth : 0
    if (rldepth > rrdepth) this.right._rotateLL()
    this._rotateRR()
  }
}

IPSet.prototype._rotateLL = function () {
  var _start = this.start
  var _end   = this.end
  var _right = this.right

  this.start = this.left.start
  this.end   = this.left.end
  this.right = this.left
  this.left  = this.left.left

  this.right.left  = this.right.right
  this.right.right = _right
  this.right.start = _start
  this.right.end   = _end

  this.right._update()
  this._update()
}

IPSet.prototype._rotateRR = function () {
  var _start = this.start
  var _end   = this.end
  var _left  = this.left

  this.start = this.right.start
  this.end   = this.right.end
  this.end   = this.right.end
  this.left  = this.right
  this.right = this.right.right

  this.left.right = this.left.left
  this.left.left  = _left
  this.left.start = _start
  this.left.end   = _end

  this.left._update()
  this._update()
}

IPSet.prototype._update = function () {
  this.depth = 1
  if (this.left) this.depth = this.left.depth + 1
  if (this.right && this.depth <= this.right.depth) this.depth = this.right.depth + 1
  this.max = Math.max(this.end, this.left ? this.left.max : 0, this.right ? this.right.max : 0)
}

module.exports = function (blocklist) {
  var tree = null
  var self = {}

  self.add = function (start, end) {
    if (!start) return
    if (typeof start === 'object') {
      end = start.end
      start = start.start
    }

    if (typeof start !== 'number') start = ip.toLong(start)

    if (!end) end = start
    if (typeof end !== 'number') end = ip.toLong(end)

    if (start < 0 || end > 4294967295 || end < start) throw new Error('Invalid block range')

    if (tree) tree.add(start, end)
    else tree = new IPSet(start, end)
  }

  self.contains = function (addr) {
    if (!tree) return false
    if (typeof addr !== 'number') addr = ip.toLong(addr)
    return tree.contains(addr)
  }

  if (Array.isArray(blocklist)) {
    blocklist.forEach(function (block) {
      self.add(block)
    })
  }

  return self
}

