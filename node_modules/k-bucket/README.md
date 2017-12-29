# k-bucket

_Stability: 2 - [Stable](https://github.com/tristanls/stability-index#stability-2---stable)_

[![NPM version](https://badge.fury.io/js/k-bucket.png)](http://npmjs.org/package/k-bucket)

Kademlia DHT K-bucket implementation as a binary tree.

## Contributors

[@tristanls](https://github.com/tristanls), [@mikedeboer](https://github.com/mikedeboer), [@deoxxa](https://github.com/deoxxa), [@feross](https://github.com/feross), [@nathanph](https://github.com/nathanph), [@allouis](https://github.com/allouis)

## Installation

    npm install k-bucket

## Tests

    npm test

## Usage

```javascript
var KBucket = require('k-bucket');

var kBucket = new KBucket({
    localNodeId: new Buffer("my node id") // default: random data
});
```

## Overview

A [*Distributed Hash Table (DHT)*](http://en.wikipedia.org/wiki/Distributed_hash_table) is a decentralized distributed system that provides a lookup table similar to a hash table.

*k-bucket* is an implementation of a storage mechanism for keys within a DHT. It stores `contact` objects which represent locations and addresses of nodes in the decentralized distributed system. `contact` objects are typically identified by a SHA-1 hash, however this restriction is lifted in this implementation. Additionally, node ids of different lengths can be compared.

This Kademlia DHT k-bucket implementation is meant to be as minimal as possible. It assumes that `contact` objects consist only of `id`. It is useful, and necessary, to attach other properties to a `contact`. For example, one may want to attach `ip` and `port` properties, which allow an application to send IP traffic to the `contact`. However, this information is extraneous and irrelevant to the operation of a k-bucket.

### arbiter function

This *k-bucket* implementation implements a conflict resolution mechanism using an `arbiter` function. The purpose of the `arbiter` is to choose between two `contact` objects with the same `id` but perhaps different properties and determine which one should be stored.  As the `arbiter` function returns the actual object to be stored, it does not need to make an either/or choice, but instead could perform some sort of operation and return the result as a new object that would then be stored. See [kBucket.update(contact, index)](#kbucketupdatecontact-index) for detailed semantics of which `contact` (`incumbent` or `candidate`) is selected.

For example, an `arbiter` function implementing a `vectorClock` mechanism would look something like:

```javascript
// contact example
var contact = {
    id: new Buffer('contactId'),
    vectorClock: 0
};

function arbiter(incumbent, candidate) {
    if (incumbent.vectorClock > candidate.vectorClock) {
        return incumbent;
    }
    return candidate;
};
```

Alternatively, consider an arbiter that implements a Grow-Only-Set CRDT mechanism:

```javascript
// contact example
var contact = {
    id: new Buffer('workerService'),
    workerNodes: {
        '17asdaf7effa2': { host: '127.0.0.1', port: 1337 },
        '17djsyqeryasu': { host: '127.0.0.1', port: 1338 }
    }
};

function arbiter(incumbent, candidate) {
    // we create a new object so that our selection is guaranteed to replace
    // the incumbent
    var merged = {
        id: incumbent.id, // incumbent.id === candidate.id within an arbiter
        workerNodes: incumbent.workerNodes
    };

    Object.keys(candidate.workerNodes).forEach(function (workerNodeId) {
        merged.workerNodes[workerNodeId] = candidate.workerNodes[workerNodeId];
    });

    return merged;
}
```

Notice that in the above case, the Grow-Only-Set assumes that each worker node has a globally unique id.

## Documentation

### KBucket

Implementation of a Kademlia DHT k-bucket used for storing contact (peer node) information.

For a step by step example of k-bucket operation you may find the following slideshow useful: [Distribute All The Things](https://docs.google.com/presentation/d/11qGZlPWu6vEAhA7p3qsQaQtWH7KofEC9dMeBFZ1gYeA/edit#slide=id.g1718cc2bc_0661).

KBucket starts off as a single k-bucket with capacity of _k_. As contacts are added, once the _k+1_ contact is added, the k-bucket is split into two k-buckets. The split happens according to the first bit of the contact node id. The k-bucket that would contain the local node id is the "near" k-bucket, and the other one is the "far" k-bucket. The "far" k-bucket is marked as _don't split_ in order to prevent further splitting. The contact nodes that existed are then redistributed along the two new k-buckets and the old k-bucket becomes an inner node within a tree data structure.

As even more contacts are added to the "near" k-bucket, the "near" k-bucket will split again as it becomes full. However, this time it is split along the second bit of the contact node id. Again, the two newly created k-buckets are marked "near" and "far" and the "far" k-bucket is marked as _don't split_. Again, the contact nodes that existed in the old bucket are redistributed. This continues as long as nodes are being added to the "near" k-bucket, until the number of splits reaches the length of the local node id.

As more contacts are added to the "far" k-bucket and it reaches its capacity, it does not split. Instead, the k-bucket emits a "ping" event (register a listener: `kBucket.on('ping', function (oldContacts, newContact) {...});` and includes an array of old contact nodes that it hasn't heard from in a while and requires you to confirm that those contact nodes still respond (literally respond to a PING RPC). If an old contact node still responds, it should be re-added (`kBucket.add(oldContact)`) back to the k-bucket. This puts the old contact on the "recently heard from" end of the list of nodes in the k-bucket. If the old contact does not respond, it should be removed (`kBucket.remove(oldContact)`) and the new contact being added now has room to be stored (`kBucket.add(newContact)`).

**Public API**
  * [KBucket.distance(firstId, secondId)](#kbucketdistancefirstid-secondid)
  * [new KBucket(options)](#new-kbucketoptions)
  * [kBucket.add(contact, \[bitIndex\])](#kbucketaddcontact-bitindex)
  * [kBucket.closest(contact, n, \[bitIndex\])](#kbucketclosestcontact-n-bitindex)
  * [kBucket.count()](#kbucketcount)
  * [kBucket.get(id, \[bitIndex\])](#kbucketgetid-bitindex)
  * [kBucket.remove(contact, \[bitIndex\])](#kbucketremovecontact-bitindex)
  * [kBucket.toArray()](#kbuckettoarray)
  * [Event 'ping'](#event-ping)

#### KBucket.distance(firstId, secondId)

  * `firstId`: _Buffer_ Buffer containing first id.
  * `secondId`: _Buffer_ Buffer containing second id.
  * Return: _Integer_ The XOR distance between `firstId` and `secondId`.

Finds the XOR distance between firstId and secondId.

#### new KBucket(options)

  * `options`:
    * `arbiter`: _Function_ _(Default: vectorClock arbiter)_ `function (incumbent, candidate) { return contact; }` An optional `arbiter` function that givent two `contact` objects with the same `id` returns the desired object to be used for updating the k-bucket. For more details, see [arbiter function](#arbiter-function).
    * `localNodeId`: _Buffer_ An optional Buffer representing the local node id. If not provided, a local node id will be created via `crypto.randomBytes(20)`.
    * `numberOfNodesPerKBucket`: _Integer_ _(Default: 20)_ The number of nodes that a k-bucket can contain before being full or split.
    * `numberOfNodesToPing`: _Integer_ _(Default: 3)_ The number of nodes to ping when a bucket that should not be split becomes full. KBucket will emit a `ping` event that contains `numberOfNodesToPing` nodes that have not been contacted the longest.
    * `root`: _Object_ _**CAUTION: reserved for internal use**_ Provides a reference to the root of the tree data structure as the k-bucket splits when new contacts are added.

Creates a new KBucket.

#### kBucket.add(contact, [bitIndex])

  * `contact`: _Object_ The contact object to add.
    * `id`: _Buffer_ Contact node id.
    * Any satellite data that is part of the `contact` object will not be altered, only `id` is used.
  * `bitIndex`: _Integer_ _(Default: 0)_ _**CAUTION: reserved for internal use**_ The bit index to which bit to check in the `id` Buffer.
  * Return: _Object_ The k-bucket itself.

Adds a `contact` to the k-bucket.

#### kBucket.closest(contact, n, [bitIndex])

  * `contact`: _Object_ The contact object to find closest contacts to.
    * `id`: _Buffer_ Contact node id.
    * Any satellite data that is part of the `contact` object will not be altered, only `id` is used.
  * `n`: _Integer_ The maximum number of closest contacts to return.
  * `bitIndex`: _Integer_ _(Default: 0)_ _**CAUTION: reserved for internal use**_  The bit index to which bit to check in the `id` Buffer.
  * Return: _Array_ Maximum of `n` closest contacts to the `contact`.

Get the `n` closest contacts to the provided `contact`. "Closest" here means: closest according to the XOR metric of the `contact` node id.

#### kBucket.count()

  * Return: _Number_ The number of contacts held in the tree

Counts the total number of contacts in the tree.

#### kBucket.determineBucket(id, [bitIndex])

_**CAUTION: reserved for internal use**_

  * `id`: _Buffer_ Id to compare `localNodeId` with.
  * `bitIndex`: _Integer_ _(Default: 0)_  The bit index to which bit to check in the `id` Buffer.
  * Return: _Integer_ -1 if `id` at `bitIndex` is 0, 1 otherwise.

Determines whether the `id` at the `bitIndex` is 0 or 1. If 0, returns -1, else 1.

#### kBucket.get(id, [bitIndex])

  * `id`: _Buffer_ The ID of the `contact` to fetch
  * `bitIndex`: _Integer_ _(Default: 0)_ _**CAUTION: reserved for internal use**_  The bit index to which bit to check in the `id` Buffer.
  * Return: _Object_ The `contact` if available, otherwise null

Retrieves the `contact`.

#### kBucket.indexOf(contact)

_**CAUTION: reserved for internal use**_

  * `contact`: _Object_ The contact object.
    * `id`: _Buffer_ Contact node id.
    * Any satellite data that is part of the `contact` object will not be altered, only `id` is used.
  * Return: _Integer_ Index of `contact` if it exists, -1 otherwise.

Returns the index of the `contact` if it exists, returns -1 otherwise.

_NOTE: `kBucket.indexOf(contact)` does not use `arbiter` in the comparison.

#### kBucket.remove(contact, [bitIndex])

  * `contact`: _Object_ The contact object to remove.
    * `id`: _Buffer_ contact node id.
    * Any satellite data can be part of the `contact` object, only `id` is used
  * `bitIndex`: _Integer_ _(Default: 0)_ _**CAUTION: reserved for internal use**_  The bit index to which bit to check in the `id` Buffer.
  * Return: _Object_ The k-bucket itself.

Removes the `contact`.

#### kBucket.splitAndAdd(contact, [bitIndex])

_**CAUTION: reserved for internal use**_

  * `contact`: _Object_ The contact object to add.
    * `id`: _Buffer_ Contact node id.
    * Any satellite data that is part of the `contact` object will not be altered, only `id` is used.
  * `bitIndex`: _Integer_ _(Default: 0)_ The bit index to which bit to check in the `id` Buffer.
  * Return: _Object_ The k-bucket itself.

Splits the bucket, redistributes contacts to the new buckets, and marks the bucket that was split as an inner node of the binary tree of buckets by setting `self.bucket = undefined`. Also, marks the "far away" bucket as `dontSplit`.

#### kBucket.toArray()

  * Return: _Array_ All of the contacts in the tree, as an array

Traverses the tree, putting all the contacts into one array.

#### kBucket.update(contact, index)

_**CAUTION: reserved for internal use**_

  * `contact`: _Object_ The contact object to update.
    * `id`: _Buffer_ Contact node id
    * Any satellite data that is part of the `contact` object will not be altered, only `id` is used.
  * `index`: _Integer_ The index in the bucket where contact exists (index has already been computed in previous calculation).

Updates the `contact` by using the `arbiter` function to compare the incumbent and the candidate. If `arbiter` function selects the old `contact` but the candidate is some new `contact`, then the new `contact` is abandoned. If `arbiter` function selects the old `contact` and the candidate is that same old `contact`, the `contact` is marked as most recently contacted (by being moved to the right/end of the bucket array). If `arbiter` function selects the new `contact`, the old `contact` is removed and the new `contact` is marked as most recently contacted.

#### Event: 'ping'

  * `oldContacts`: _Array_ The array of contacts to ping.
  * `newContact`: _Object_ The new contact to be added if one of old contacts does not respond.

Emitted every time a contact is added that would exceed the capacity of a _don't split_ k-bucket it belongs to.

## Sources

The implementation has been sourced from:

  - [A formal specification of the Kademlia distributed hash table](http://maude.sip.ucm.es/kademlia/files/pita_kademlia.pdf)
  - [Distributed Hash Tables (part 2)](http://offthelip.org/?p=157)
