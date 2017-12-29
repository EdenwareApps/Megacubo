/*

index.js - Kademlia DHT K-bucket implementation as a binary tree.

The MIT License (MIT)

Copyright (c) 2013-2015 Tristan Slominski

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

*/
"use strict";

var assert = require('assert');
var bufferEqual = require('buffer-equal');
var crypto = require('crypto');
var events = require('events');
var inherits = require('inherits');

/*
  * `options`:
    * `arbiter`: _Function_ _(Default: vectorClock arbiter)_
        `function (incumbent, candidate) { return contact; }` An optional
        `arbiter` function that givent two `contact` objects with the same `id`
        returns the desired object to be used for updating the k-bucket. For
        more details, see [arbiter function](#arbiter-function).
    * `localNodeId`: _Buffer_ An optional Buffer representing the local node id.
        If not provided, a local node id will be created via
        `crypto.randomBytes(20)`.
    * `numberOfNodesPerKBucket`: _Integer_ _(Default: 20)_ The number of nodes
        that a k-bucket can contain before being full or split.
    * `numberOfNodesToPing`: _Integer_ _(Default: 3)_ The number of nodes to
        ping when a bucket that should not be split becomes full. KBucket will
        emit a `ping` event that contains `numberOfNodesToPing` nodes that have
        not been contacted the longest.
    * `root`: _Object_ _**CAUTION: reserved for internal use**_ Provides a
        reference to the root of the tree data structure as the k-bucket splits
        when new contacts are added.
*/
var KBucket = module.exports = function KBucket (options) {
    var self = this;
    options = options || {};
    events.EventEmitter.call(self);

    // use an arbiter from options or vectorClock arbiter by default
    self.arbiter = options.arbiter || function arbiter(incumbent, candidate) {
        if (incumbent.vectorClock > candidate.vectorClock) {
            return incumbent;
        }
        return candidate;
    };

    // the bucket array has least-recently-contacted at the "front/left" side
    // and the most-recently-contaced at the "back/right" side
    self.bucket = [];
    self.localNodeId = options.localNodeId || crypto.randomBytes(20);
    if (!Buffer.isBuffer(self.localNodeId)) {
        throw new Error("localNodeId is not a Buffer");
    }
    self.numberOfNodesPerKBucket = options.numberOfNodesPerKBucket || 20;
    self.numberOfNodesToPing = options.numberOfNodesToPing || 3;
    self.root = options.root || self;

    // V8 hints
    self.dontSplit = null;
    self.low = null;
    self.high = null;
};

inherits(KBucket, events.EventEmitter);

KBucket.distance = function distance (firstId, secondId) {
    var max = Math.max(firstId.length, secondId.length);
    var accumulator = '';
    for (var i = 0; i < max; i++) {
        var maxDistance = (firstId[i] === undefined || secondId[i] === undefined);
        if (maxDistance) {
            accumulator += (255).toString(16);
        } else {
            accumulator += (firstId[i] ^ secondId[i]).toString(16);
        }
    }
    return parseInt(accumulator, 16);
};

// contact: *required* the contact object to add
// bitIndex: the bitIndex to which bit to check in the Buffer for navigating
//           the binary tree
KBucket.prototype.add = function add (contact, bitIndex) {
    var self = this;

    // first check whether we are an inner node or a leaf (with bucket contents)
    if (!self.bucket) {
        // this is not a leaf node but an inner node with 'low' and 'high'
        // branches; we will check the appropriate bit of the identifier and
        // delegate to the appropriate node for further processing
        bitIndex = bitIndex || 0;

        if (self.determineBucket(contact.id, bitIndex++) < 0) {
            return self.low.add(contact, bitIndex);
        } else {
            return self.high.add(contact, bitIndex);
        }
    }

    // check if the contact already exists
    var index = self.indexOf(contact);
    if (index >= 0) {
        self.update(contact, index);
        return self;
    }

    if (self.bucket.length < self.numberOfNodesPerKBucket) {
        self.bucket.push(contact);
        return self;
    }

    // the bucket is full
    if (self.dontSplit) {
        // we are not allowed to split the bucket
        // we need to ping the first self.numberOfNodesToPing
        // in order to determine if they are alive
        // only if one of the pinged nodes does not respond, can the new contact
        // be added (this prevents DoS flodding with new invalid contacts)
        self.root.emit('ping',
            self.bucket.slice(0, self.numberOfNodesToPing),
            contact);
        return self;
    }

    return self.splitAndAdd(contact, bitIndex);
};

// contact: Object *required* contact object
//   id: Buffer *require* node id
// n: Integer *required* maximum number of closest contacts to return
// bitIndex: Integer (Default: 0)
// Return: Array of maximum of `n` closest contacts to the `contact`
KBucket.prototype.closest = function closest (contact, n, bitIndex) {
    var self = this;

    var contacts;

    if (!self.bucket) {
        bitIndex = bitIndex || 0;

        if (self.determineBucket(contact.id, bitIndex++) < 0) {
            contacts = self.low.closest(contact, n, bitIndex);
            if (contacts.length < n) {
                contacts = contacts.concat(self.high.closest(contact, n, bitIndex));
            }
        } else {
            contacts = self.high.closest(contact, n, bitIndex);
            if (contacts.length < n) {
                contacts = contacts.concat(self.low.closest(contact, n, bitIndex));
            }
        }
        return contacts.slice(0, n);
    }

    contacts = self.bucket.slice();
    contacts.forEach(function (storedContact) {
        storedContact.distance = KBucket.distance(storedContact.id, contact.id);
    });

    contacts.sort(function (a, b) {return a.distance - b.distance;});

    return contacts.slice(0, n);
};

// Counts the number of contacts recursively.
// If this is a leaf, just return the number of contacts contained. Otherwise,
// return the length of the high and low branches combined.
KBucket.prototype.count = function count () {
    var self = this;

    if (self.bucket) {
        return self.bucket.length;
    } else {
        return self.high.count() + self.low.count();
    }
};

// Determines whether the id at the bitIndex is 0 or 1. If 0, returns -1, else 1
// id: a Buffer to compare localNodeId with
// bitIndex: the bitIndex to which bit to check in the id Buffer
KBucket.prototype.determineBucket = function determineBucket (id, bitIndex) {
    var self = this;

    bitIndex = bitIndex || 0;

    // **NOTE** remember that id is a Buffer and has granularity of
    // bytes (8 bits), whereas the bitIndex is the _bit_ index (not byte)

    // id's that are too short are put in low bucket (1 byte = 8 bits)
    // parseInt(bitIndex / 8) finds how many bytes the bitIndex describes
    // bitIndex % 8 checks if we have extra bits beyond byte multiples
    // if number of bytes is <= no. of bytes described by bitIndex and there
    // are extra bits to consider, this means id has less bits than what
    // bitIndex describes, id therefore is too short, and will be put in low
    // bucket
    var bytesDescribedByBitIndex = parseInt(bitIndex / 8, 10);
    var bitIndexWithinByte = bitIndex % 8;
    if ((id.length <= bytesDescribedByBitIndex)
        && (bitIndexWithinByte != 0))
        return -1;

    var byteUnderConsideration = id[bytesDescribedByBitIndex];

    // byteUnderConsideration is an integer from 0 to 255 represented by 8 bits
    // where 255 is 11111111 and 0 is 00000000
    // in order to find out whether the bit at bitIndexWithinByte is set
    // we construct Math.pow(2, (7 - bitIndexWithinByte)) which will consist
    // of all bits being 0, with only one bit set to 1
    // for example, if bitIndexWithinByte is 3, we will construct 00010000 by
    // Math.pow(2, (7 - 3)) -> Math.pow(2, 4) -> 16
    if (byteUnderConsideration & Math.pow(2, (7 - bitIndexWithinByte))) {
        return 1;
    }

    return -1;
};

// Get a contact by its exact ID.
// If this is a leaf, loop through the bucket contents and return the correct
// contact if we have it or null if not. If this is an inner node, determine
// which branch of the tree to traverse and repeat.
// id: *required* a Buffer specifying the ID of the contact to fetch
// bitIndex: the bitIndex to which bit to check in the Buffer for navigating
//           the binary tree
KBucket.prototype.get = function get (id, bitIndex) {
    var self = this;

    if (!self.bucket) {
        bitIndex = bitIndex || 0;

        if (self.determineBucket(id, bitIndex++) < 0) {
            return self.low.get(id, bitIndex);
        } else {
            return self.high.get(id, bitIndex);
        }
    }

    var index = self.indexOf({id: id}); // index of uses contact.id for matching
    if (index < 0) {
        return null; // contact not found
    }

    return self.bucket[index];
};

// Returns the index of the contact if it exists
// **NOTE**: indexOf() does not compare vectorClock
KBucket.prototype.indexOf = function indexOf (contact) {
    var self = this;
    for (var i = 0; i < self.bucket.length; i++) {
        if (bufferEqual(self.bucket[i].id, contact.id)) return i;
    }
    return -1;
};

// contact: *required* the contact object to remove
// bitIndex: the bitIndex to which bit to check in the Buffer for navigating
//           the binary tree
KBucket.prototype.remove = function remove (contact, bitIndex) {
    var self = this;

    // first check whether we are an inner node or a leaf (with bucket contents)
    if (!self.bucket) {
        // this is not a leaf node but an inner node with 'low' and 'high'
        // branches; we will check the appropriate bit of the identifier and
        // delegate to the appropriate node for further processing
        bitIndex = bitIndex || 0;

        if (self.determineBucket(contact.id, bitIndex++) < 0) {
            return self.low.remove(contact, bitIndex);
        } else {
            return self.high.remove(contact, bitIndex);
        }
    }

    var index = self.indexOf(contact);
    if (index >= 0) self.bucket.splice(index, 1);
    return self;
};

// Splits the bucket, redistributes contacts to the new buckets, and marks the
// bucket that was split as an inner node of the binary tree of buckets by
// setting self.bucket = undefined;
// contact: *required* the contact object to add
// bitIndex: the bitIndex to which byte to check in the Buffer for navigating the
//          binary tree
KBucket.prototype.splitAndAdd = function splitAndAdd (contact, bitIndex) {
    var self = this;
    self.low = new KBucket({
        arbiter: self.arbiter,
        localNodeId: self.localNodeId,
        root: self.root,
        numberOfNodesPerKBucket: self.numberOfNodesPerKBucket,
        numberOfNodesToPing: self.numberOfNodesToPing
    });
    self.high = new KBucket({
        arbiter: self.arbiter,
        localNodeId: self.localNodeId,
        root: self.root,
        numberOfNodesPerKBucket: self.numberOfNodesPerKBucket,
        numberOfNodesToPing: self.numberOfNodesToPing
    });

    bitIndex = bitIndex || 0;

    // redistribute existing contacts amongst the two newly created buckets
    self.bucket.forEach(function (storedContact) {
        if (self.determineBucket(storedContact.id, bitIndex) < 0) {
            self.low.add(storedContact);
        } else {
            self.high.add(storedContact);
        }
    });

    self.bucket = undefined; // mark as inner tree node

    // don't split the "far away" bucket
    // we check where the local node would end up and mark the other one as
    // "dontSplit" (i.e. "far away")
    if (self.determineBucket(self.localNodeId, bitIndex) < 0) {
        // local node belongs to "low" bucket, so mark the other one
        self.high.dontSplit = true;
    } else {
        self.low.dontSplit = true;
    }

    // add the contact being added
    self.add(contact, bitIndex);

    return self;
};

// Returns all the contacts contained in the tree as an array.
// If self is a leaf, return a copy of the bucket. `slice` is used so that we
// don't accidentally leak an internal reference out that might be accidentally
// misused. If self is not a leaf, return the union of the low and high
// branches (themselves also as arrays).
KBucket.prototype.toArray = function toArray () {
    var self = this;

    if (self.bucket) {
        return self.bucket.slice(0);
    } else {
        return self.low.toArray().concat(self.high.toArray());
    }
};

// Updates the contact selected by the arbiter.
// If the selection is our old contact and the candidate is some new contact
// then the new contact is abandoned (not added).
// If the selection is our old contact and the candidate is our old contact
// then we are refreshing the contact and it is marked as most recently
// contacted (by being moved to the right/end of the bucket array).
// If the selection is our new contact, the old contact is removed and the new
// contact is marked as most recently contacted.
// contact: *required* the contact to update
// index: *required* the index in the bucket where contact exists
//        (index has already been computed in a previous calculation)
KBucket.prototype.update = function update (contact, index) {
    var self = this;
    // sanity check
    assert.ok(bufferEqual(self.bucket[index].id, contact.id),
        "indexOf() calculation resulted in wrong index");

    var incumbent = self.bucket[index];
    var selection = self.arbiter(incumbent, contact);
    if (selection === incumbent && incumbent !== contact) {
        // if the selection is our old contact and the candidate is some new
        // contact, then there is nothing to do
        return;
    }

    self.bucket.splice(index, 1); // remove old contact
    self.bucket.push(selection); // add more recent contact version
};
