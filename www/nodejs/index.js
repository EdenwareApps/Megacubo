let ext
const fs = require('fs')
const file = __dirname +'/dist/main.'
if(fs.existsSync(file +'cjs')) {
    ext = 'cjs'
} else {
    ext = 'jsc'
    require('bytenode')
}
module.exports = require(file + ext)