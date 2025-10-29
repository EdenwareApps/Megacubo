/*

Experimental: Meant to be used as a module in node.js. Feedback welcome.

import megacubo from 'megacubo'
//const megacubo = require('megacubo')
// megacubo = {paths, config, osd, channels, lists, energy, lang, options, streamer, storage, renderer}
megacubo.paths // app folder paths
megacubo.config // app config
megacubo.osd // on screen display messages
megacubo.channels // channels list
megacubo.lists // lists
megacubo.epg.manager // EPG manager
megacubo.lists.manager // lists manager
megacubo.energy // close app
megacubo.lang // language manager
megacubo.options // options manager
megacubo.streamer // playback manager
megacubo.storage // storage manager
megacubo.renderer // menu manager

(async () => {
    await megacubo.renderer.ready()
    await megacubo.lists.manager.addList('https://.../channels.m3u', 'My IPTV List')
    console.log('List added', ret)
    }).catch(err => {
        console.error('Error adding list', err)
    })
})

*/

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the ES module version from www/nodejs
const mainModule = await import('./www/nodejs/main.mjs');

// Export all the named exports as a default object
export default {
    ...mainModule
};