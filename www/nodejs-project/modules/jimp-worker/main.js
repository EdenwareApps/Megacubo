const path = require('path'), workers = require('../multi-worker/main')
module.exports = workers.load(path.join(__dirname, '../jimp-worker'))