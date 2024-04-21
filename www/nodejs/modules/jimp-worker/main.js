import workers from "../multi-worker/main.js";
import paths from '../paths/paths.js'
export default workers.load(paths.cwd + '/modules/jimp-worker/jimp-worker.js');
