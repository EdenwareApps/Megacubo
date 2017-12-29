# FIFO

Javascript FIFO queue implemented using a double linked-list

	npm install fifo

# Usage is simple

``` js
var fifo = require('fifo');

fifo.push('hello');
fifo.push('world');

console.log(fifo.first()); // prints hello
console.log(fifo.last());  // prints world

console.log(fifo.shift()); // prints hello
console.log(fifo.shift()); // prints world

var node = fifo.push('meh');

fifo.remove(node);     // remove 'meh' from the stack
fifo.unshift('hello'); // insert at the beginning
```

`fifo` uses a linked list behind the scene so `push`, `shift`, `unshift`, and `remove` all run in O(1)

# License

MIT
