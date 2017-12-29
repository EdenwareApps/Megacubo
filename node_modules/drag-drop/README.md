# drag-drop [![travis](https://img.shields.io/travis/feross/drag-drop/master.svg)](https://travis-ci.org/feross/drag-drop) [![npm](https://img.shields.io/npm/v/drag-drop.svg)](https://npmjs.org/package/drag-drop) [![downloads](https://img.shields.io/npm/dm/drag-drop.svg)](https://npmjs.org/package/drag-drop)

### HTML5 drag & drop for humans

In case you didn't know, the
[HTML5 drag and drop API](https://developer.mozilla.org/en-US/docs/Using_files_from_web_applications)
is a
[total disaster](http://www.quirksmode.org/blog/archives/2009/09/the_html5_drag.html)!
This is an attempt to make the API usable by mere mortals.

This module works in the browser with [browserify](http://browserify.org/).

**Note:** If you do not use browserify, use the included standalone file
[`dragdrop.min.js`](https://rawgit.com/feross/drag-drop/master/dragdrop.min.js). This exports a `DragDrop` function on `window`.

### live demo

See [https://instant.io](https://instant.io).

### features

- simple API
- adds a `drag` class to the drop target on hover, for easy styling!
- optionally, get the file(s) as a Buffer (see [buffer](https://github.com/feross/buffer))

### install

```
npm install drag-drop
```

### usage

```js
var dragDrop = require('drag-drop')

dragDrop('#dropTarget', function (files, pos) {
  console.log('Here are the dropped files', files)
  console.log('Dropped at coordinates', pos.x, pos.y)
})
```

Another handy thing this does is add a `drag` class to the drop target when the user
is dragging a file over the drop target. Useful for styling the drop target to make
it obvious that this is a drop target!

### complete example

```js
var dragDrop = require('drag-drop')

// You can pass in a DOM node or a selector string!
dragDrop('#dropTarget', function (files) {
  console.log('Here are the dropped files', files)

  // `files` is an Array!
  files.forEach(function (file) {
    console.log(file.name)
    console.log(file.size)
    console.log(file.type)
    console.log(file.lastModifiedData)
    console.log(file.fullPath)

    // convert the file to a Buffer that we can use!
    var reader = new FileReader()
    reader.addEventListener('load', function (e) {
      // e.target.result is an ArrayBuffer
      var arr = new Uint8Array(e.target.result)
      var buffer = new Buffer(arr)

      // do something with the buffer!
    })
    reader.addEventListener('error', function (err) {
      console.error('FileReader error' + err)
    })
    reader.readAsArrayBuffer(file)
  })
})
```

### get files as buffers

If you prefer to access file data as Buffers, then just require drag-drop like this:

```js
var dragDrop = require('drag-drop/buffer')

dragDrop('#dropTarget', function (files) {
  files.forEach(function (file) {
    // file is actually a buffer!
    console.log(file.readUInt32LE(0))
    console.log(file.toJSON())
    console.log(file.toString('hex')) // etc...

    // but it still has all the normal file properties!
    console.log(file.name)
    console.log(file.size)
    console.log(file.type)
    console.log(file.lastModifiedDate)
  })
}
```

### remove listeners

To stop listening for drag & drop events and remove the event listeners, just use the
`remove` function returned by the `dragDrop` function.

```js
var dragDrop = require('drag-drop')

var remove = dragDrop('#dropTarget', function (files, pos) {
  console.log('Here are the dropped files', files)
  console.log('Dropped at coordinates', pos.x, pos.y)
})

// ... at some point in the future, stop listening for drag & drop events
remove()
```

### detect `dragenter`, `dragover` and `dragleave` events

Instead of passing just an `ondrop` function as the second argument, instead pass an
object with all the events you want to listen for:

```js
var dragDrop = require('drag-drop')

dragDrop('#dropTarget', {
  onDrop: function (files, pos) {
    console.log('Here are the dropped files', files)
    console.log('Dropped at coordinates', pos.x, pos.y)
  },
  onDragEnter: function () {},
  onDragOver: function () {},
  onDragLeave: function () {}
})
```

### detect drag-and-dropped text

If the user highlights text and drags it, we capture that as a separate event.
Listen for it like this:

```js
var dragDrop = require('drag-drop')

dragDrop('#dropTarget', {
  onDropText: function (text, pos) {
    console.log('Here is the dropped text', text)
    console.log('Dropped at coordinates', pos.x, pos.y)
  }
})
```

### a note about `file://` urls

Don't run your app from `file://`. For security reasons, browsers do not allow you to
run your app from `file://`.  In fact, many of the powerful storage APIs throw errors
if you run the app locally from `file://`.

Instead, start a local server and visit your site at `http://localhost:port`.

### license

MIT. Copyright (c) [Feross Aboukhadijeh](http://feross.org).
