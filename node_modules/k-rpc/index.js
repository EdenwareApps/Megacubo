var socket = require('k-rpc-socket')
var KBucket = require('k-bucket')
var equals = require('buffer-equals')
var crypto = require('crypto')
var events = require('events')
var util = require('util')

var K = 20
var MAX_CONCURRENCY = 16
var BOOTSTRAP_NODES = [
  {host: 'router.bittorrent.com', port: 6881},
  {host: 'router.utorrent.com', port: 6881},
  {host: 'dht.transmissionbt.com', port: 6881}
]

module.exports = RPC

function RPC (opts) {
  if (!(this instanceof RPC)) return new RPC(opts)
  if (!opts) opts = {}

  var self = this

  this.id = toBuffer(opts.id || opts.nodeId || crypto.randomBytes(20))
  this.socket = socket(opts)
  this.bootstrap = toBootstrapArray(opts.nodes || opts.bootstrap)
  this.concurrency = opts.concurrency || MAX_CONCURRENCY
  this.backgroundConcurrency = opts.backgroundConcurrency || (this.concurrency / 4) | 0
  this.k = opts.k || K
  this.destroyed = false

  this.pending = []
  this.nodes = null

  this.socket.on('query', onquery)
  this.socket.on('response', onresponse)
  this.socket.on('warning', onwarning)
  this.socket.on('error', onerror)
  this.socket.on('update', onupdate)
  this.socket.on('listening', onlistening)

  events.EventEmitter.call(this)
  this.clear()

  function onupdate () {
    while (self.pending.length && self.socket.inflight < self.concurrency) {
      var next = self.pending.shift()
      self.query(next[0], next[1], next[2])
    }
  }

  function onerror (err) {
    self.emit('error', err)
  }

  function onlistening () {
    self.emit('listening')
  }

  function onwarning (err) {
    self.emit('warning', err)
  }

  function onquery (query, peer) {
    addNode(query.a, peer)
    self.emit('query', query, peer)
  }

  function onresponse (reply, peer) {
    addNode(reply.r, peer)
  }

  function addNode (data, peer) {
    if (data && isNodeId(data.id) && !self.nodes.get(data.id)) {
      self._addNode({
        id: data.id,
        host: peer.address || peer.host,
        port: peer.port,
        distance: 0
      })
    }
  }
}

util.inherits(RPC, events.EventEmitter)

RPC.prototype.response = function (node, query, response, nodes, cb) {
  if (typeof nodes === 'function') {
    cb = nodes
    nodes = null
  }

  if (!response.id) response.id = this.id
  if (nodes) response.nodes = encodeNodes(nodes)
  this.socket.response(node, query, response, cb)
}

RPC.prototype.error = function (node, query, error, cb) {
  this.socket.error(node, query, error, cb)
}

RPC.prototype.bind = function (port, cb) {
  this.socket.bind(port, cb)
}

RPC.prototype.address = function () {
  return this.socket.address()
}

RPC.prototype.queryAll = function (nodes, message, visit, cb) {
  if (!message.a) message.a = {}
  if (!message.a.id) message.a.id = this.id

  var stop = false
  var missing = nodes.length
  var hits = 0
  var error = null

  if (!missing) return cb(new Error('No nodes to query'), 0)

  for (var i = 0; i < nodes.length; i++) {
    this.query(nodes[i], message, done)
  }

  function done (err, res, peer) {
    if (!err) hits++
    else if (err.code >= 300 && err.code < 400) error = err
    if (!err && !stop) {
      if (visit && visit(res, peer) === false) stop = true
    }
    if (!--missing) cb(hits ? null : error || new Error('All queries failed'), hits)
  }
}

RPC.prototype.query = function (node, message, cb) {
  if (this.socket.inflight >= this.concurrency) {
    this.pending.push([node, message, cb])
  } else {
    if (!message.a) message.a = {}
    if (!message.a.id) message.a.id = this.id
    if (node.token) message.a.token = node.token
    this.socket.query(node, message, cb)
  }
}

RPC.prototype.destroy = function (cb) {
  this.destroyed = true
  this.socket.destroy(cb)
}

RPC.prototype.clear = function () {
  var self = this

  this.nodes = new KBucket({
    localNodeId: this.id,
    numberOfNodesPerKBucket: this.k,
    numberOfNodesToPing: this.concurrency,
    ping: onping
  })

  function onping (older, newer) {
    self.emit('ping', older, newer)
  }
}

RPC.prototype.populate = function (target, message, cb) {
  this._closest(target, message, true, null, cb)
}

RPC.prototype.closest = function (target, message, visit, cb) {
  this._closest(target, message, false, visit, cb)
}

RPC.prototype._addNode = function (node) {
  var old = this.nodes.get(node.id)
  this.nodes.add(node)
  if (!old) this.emit('node', node)
}

RPC.prototype._closest = function (target, message, background, visit, cb) {
  if (!cb) cb = noop

  var self = this
  var count = 0
  var queried = {}
  var pending = 0
  var once = true
  var stop = false

  if (!message.a) message.a = {}
  if (!message.a.id) message.a.id = this.id

  var table = new KBucket({
    localNodeId: target,
    numberOfNodesPerKBucket: this.k,
    numberOfNodesToPing: this.concurrency
  })

  var evt = background ? 'postupdate' : 'update'
  this.socket.on(evt, kick)
  kick()

  function kick () {
    if (self.destroyed || self.socket.inflight >= self.concurrency) return

    var otherInflight = self.pending.length + self.socket.inflight - pending
    if (background && self.socket.inflight >= self.backgroundConcurrency && otherInflight) return

    var closest = table.closest({id: target}, self.k)
    if (!closest.length || closest.length < self.bootstrap.length) {
      closest = self.nodes.closest({id: target}, self.k)
      if (!closest.length || closest.length < self.bootstrap.length) bootstrap()
    }

    for (var i = 0; i < closest.length; i++) {
      if (stop) break
      if (self.socket.inflight >= self.concurrency) return

      var peer = closest[i]
      var id = peer.host + ':' + peer.port
      if (queried[id]) continue
      queried[id] = true

      pending++
      self.socket.query(peer, message, afterQuery)
    }

    if (!pending) {
      self.socket.removeListener(evt, kick)
      process.nextTick(done)
    }
  }

  function done () {
    cb(null, count)
  }

  function bootstrap () {
    if (!once) return
    once = false
    self.bootstrap.forEach(function (peer) {
      pending++
      self.socket.query(peer, message, afterQuery)
    })
  }

  function afterQuery (err, res, peer) {
    pending--
    if (peer) queried[peer.address + ':' + peer.port] = true // need this for bootstrap nodes

    var r = res && res.r
    if (!r) return

    if (peer && peer.id && self.nodes.get(peer.id)) {
      if (err && err.code === 'ETIMEDOUT') self.nodes.remove(peer)
    }

    if (!err && isNodeId(r.id)) {
      count++
      add({
        id: r.id,
        port: peer.port,
        host: peer.host || peer.address,
        distance: 0
      })
    }

    var nodes = r.nodes ? parseNodes(r.nodes) : []
    for (var i = 0; i < nodes.length; i++) add(nodes[i])

    if (visit && visit(res, peer) === false) stop = true

    kick()
  }

  function add (node) {
    if (equals(node.id, self.id)) return
    table.add(node)
  }
}

function toBootstrapArray (val) {
  if (val === false) return []
  if (val === true) return BOOTSTRAP_NODES
  return [].concat(val || BOOTSTRAP_NODES).map(parsePeer)
}

function isNodeId (id) {
  return id && Buffer.isBuffer(id) && id.length === 20
}

function encodeNodes (nodes) {
  var buf = new Buffer(nodes.length * 26)
  var ptr = 0

  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i]
    if (!isNodeId(node.id)) continue
    node.id.copy(buf, ptr)
    ptr += 20
    var ip = (node.host || node.address).split('.')
    for (var j = 0; j < 4; j++) buf[ptr++] = parseInt(ip[j] || 0, 10)
    buf.writeUInt16BE(node.port, ptr)
    ptr += 2
  }

  if (ptr === buf.length) return buf
  return buf.slice(0, ptr)
}

function parseNodes (buf) {
  var contacts = []

  try {
    for (var i = 0; i < buf.length; i += 26) {
      var port = buf.readUInt16BE(i + 24)
      if (!port) continue
      contacts.push({
        id: buf.slice(i, i + 20),
        host: parseIp(buf, i + 20),
        port: port,
        distance: 0,
        token: null
      })
    }
  } catch (err) {
    // do nothing
  }

  return contacts
}

function parseIp (buf, offset) {
  return buf[offset++] + '.' + buf[offset++] + '.' + buf[offset++] + '.' + buf[offset++]
}

function parsePeer (peer) {
  if (typeof peer === 'string') return {host: peer.split(':')[0], port: Number(peer.split(':')[1])}
  return peer
}

function noop () {}

function toBuffer (str) {
  if (typeof str === 'string') return new Buffer(str, 'hex')
  if (Buffer.isBuffer(str)) return str
  throw new Error('Pass a buffer or a string')
}
