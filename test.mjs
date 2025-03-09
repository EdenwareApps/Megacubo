import * as megacubo from './www/nodejs/main.mjs';
//import * as megacubo from 'megacubo';
//const megacubo = require('megacubo');

(async () => {
    global.megacubo = megacubo
    console.log('init')
    megacubo.renderer.ready(null, true) // fake client is "ready"
    await megacubo.init('en', 'America/New_York')
    megacubo.config.set('enable-console', true)
    try {
        const urls = [
            'http://.../playlist.m3u8'
        ]
        for(let url of urls) {
            try {
                let ret = await megacubo.lists.manager.add(url, 'test', 'test')
                console.log('list added', url, ret)
                await megacubo.lists.loader.addListNow(url)
                console.log('list added now', url)
            } catch (e) {
                console.error('Error adding list: ' + e)
            }
        }
        console.log('waiting for lists to be ready...')
        await megacubo.lists.ready()
        console.table(Object.keys(megacubo.lists.lists))
        console.log('seaching for cnn...')
        const result = await megacubo.lists.search('cnn')
        console.log('result', result)
    } catch (e) {
        console.error('Error adding list: ' + e)
    }
    console.log('done.')
    await process.exit(0)
})()
