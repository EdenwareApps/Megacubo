## network-address

get the local network address of your machine

```
npm install network-address
```

[![build status](http://img.shields.io/travis/mafintosh/network-address.svg?style=flat)](http://travis-ci.org/mafintosh/network-address)

it is easy to use

``` js
var address = require('network-address')

console.log(address())      // prints something like 192.168.3.102
console.log(address.ipv6()) // prints something like fc00::5137:ecb:55be:c2fc
```

it is also available as a command line tool

```
npm install -g network-address
```

you are now able to run `network-address` in your terminal