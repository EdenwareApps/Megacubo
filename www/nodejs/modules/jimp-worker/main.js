const workers = require('../multi-worker/main')
module.exports = workers.load(global.paths.cwd +'/modules/jimp-worker')