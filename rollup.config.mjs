import fs from 'fs'
import terser from '@rollup/plugin-terser'
import svelte from 'rollup-plugin-svelte'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import builtins from 'rollup-plugin-node-builtins'
import json from '@rollup/plugin-json'
import css from 'rollup-plugin-import-css'
import sveltePreprocess from 'svelte-preprocess'
import { getBabelOutputPlugin } from '@rollup/plugin-babel';
import babelConfig from './babel.config.json' with { type: 'json'};
import babelRendererConfig from './babel.config.renderer.json' with { type: 'json'};
import replace from '@rollup/plugin-replace';
// import { visualizer } from 'rollup-plugin-visualizer';

const plugins = [
  resolve({
    browser: false,
    preferBuiltins: false // form-data
  }),
  commonjs({sourceMap: false}),
  json({compact: true}),
  getBabelOutputPlugin(babelConfig), // ensure node 12 compat
  replace({
    preventAssignment: false,
    delimiters: ['', ''],
    values: {
      'fs/promises")': 'fs").promises',
      'fs/promises\')': 'fs\').promises',
      '\'node:': '\'',
      '"node:': '"',
      'getFilename()': '__filename',
      'getDirname()': '__dirname',
      'aliasedRequire(\'./locale': 'require(\'./moment-locale', // moment locales
      'require("electron")': 'process.platform=="android"?{}:require("electron")' // dummy value for Android
    }
  }),
  terser({
    ecma: 2018,
    maxWorkers: 4,
    keep_classnames: true,
    keep_fnames: true,
    output: {
      comments: false
    }
  })
]

const pluginsMain = [
  resolve({
    browser: false,
    preferBuiltins: false // form-data
  }),
  commonjs({sourceMap: false}),
  json({compact: true}),
  getBabelOutputPlugin(babelConfig), // transform esm to cjs here
  replace({
    preventAssignment: false,
    delimiters: ['', ''],
    values: {
      'fs/promises")': 'fs").promises',
      'fs/promises\')': 'fs\').promises',
      '\'node:': '\'',
      '"node:': '"',
      'getFilename()': '__filename',
      'getDirname()': '__dirname',
      'aliasedRequire(\'./locale': 'require(\'./moment-locale', // moment locales
      'require("electron")': 'process.platform=="android"?{}:require("electron")' // dummy value for Android
    }
  }),
  terser({
    ecma: 2018,
    maxWorkers: 4,
    keep_classnames: true,
    keep_fnames: true,
    output: {
      comments: false
    }
  })
]

const pluginsPremium = [
  resolve({
    browser: false,
    preferBuiltins: false // form-data
  }),
  commonjs({sourceMap: false}),
  json({compact: true}),
  getBabelOutputPlugin(babelConfig), // transform esm to cjs here
  replace({
    preventAssignment: false,
    delimiters: ['', ''],
    values: {
      'fs/promises")': 'fs").promises',
      'fs/promises\')': 'fs\').promises',
      '\'node:': '\'',
      '"node:': '"',
      'getFilename()': '__filename',
      'getDirname()': '__dirname',
      'aliasedRequire(\'./locale': 'require(\'./moment-locale', // moment locales
      'require("electron")': 'process.platform=="android"?{}:require("electron")' // dummy value for Android
    }
  }),
  terser({
    ecma: 2018,
    maxWorkers: 4,
    keep_classnames: true,
    keep_fnames: true,
    output: {
      comments: false
    }
  })
  /*,
  visualizer({
    open: true,
    template: 'network'
  })
  */
]

const pluginsRenderer = [
  svelte({        
    preprocess: sveltePreprocess()
  }),
  resolve({
    browser: true,
    exportConditions: ['svelte'],
    extensions: ['.svelte'],
    preferBuiltins: false
  }),
  builtins(),
  commonjs({sourceMap: false}),
  json({compact: true}),
  css({
    output: 'renderer.css'
  }),
  getBabelOutputPlugin(babelRendererConfig),
  terser({
    ecma: 2015,
    maxWorkers: 4,
    keep_classnames: true,
    keep_fnames: true,
    output: {
      comments: false
    }
  })
]

const outputs = [
  {
    input: {
      renderer: 'www/nodejs/renderer/src/App.svelte'
    },
    output: {
      dir: 'www/nodejs/renderer/dist',
      format: 'iife',
      name: 'App'
    },
    plugins: pluginsRenderer
  },
  {
    input: {
      capacitor: 'capacitor.mjs'
    },
    output: {
      dir: 'www/nodejs/renderer/dist',
      format: 'iife',
      name: 'capacitor',
      inlineDynamicImports: true
    },
    plugins: pluginsRenderer
  },
  {
    input: 'www/nodejs/main.mjs',
    output: {
      format: 'esm',
      file: 'www/nodejs/dist/main.js',
      inlineDynamicImports: true
    },
    plugins: pluginsMain,
    external: [
      /(@?electron\/?)/,
      /premium\./
    ]
  },
  {
    input: 'www/nodejs/preload.mjs',
    output: {
      format: 'cjs',
      file: 'www/nodejs/dist/preload.js',
      name: 'preload',
      inlineDynamicImports: true
    },
    plugins,
    external: [
      /(@?electron\/?)/
    ]
  },
  {
    input: 'www/nodejs/modules/lists/updater-worker.js',
    output: {
      format: 'cjs',
      file: 'www/nodejs/dist/updater-worker.js',
      inlineDynamicImports: true
    },
    plugins,
    external: []
  },
  {
    input: 'www/nodejs/modules/jimp-worker/jimp-worker.js',
    output: {
      format: 'cjs',
      file: 'www/nodejs/dist/jimp-worker.js',
      inlineDynamicImports: true
    },
    plugins,
    external: []
  },
  {
    input: 'www/nodejs/modules/lists/epg-worker.js',
    output: {
      format: 'cjs',
      file: 'www/nodejs/dist/epg-worker.js',
      inlineDynamicImports: true
    },
    plugins,
    external: []
  },
  {
    input: 'www/nodejs/modules/streamer/utils/mpegts-processor-worker.js',
    output: {
      format: 'cjs',
      file: 'www/nodejs/dist/mpegts-processor-worker.js',
      inlineDynamicImports: true
    },
    plugins,
    external: []
  },
  {
    input: 'www/nodejs/modules/multi-worker/worker.mjs',
    output: {
      format: 'cjs',
      file: 'www/nodejs/dist/worker.js',
      inlineDynamicImports: true
    },
    plugins,
    external: []
  }
]

if(fs.existsSync('www/nodejs/modules/premium/premium.js')) {
  outputs.push({
    input: 'www/nodejs/modules/premium/premium.js',
    output: {
      format: 'cjs',
      file: 'www/nodejs/dist/premium.js',
      inlineDynamicImports: true
    },
    plugins: pluginsPremium,
    external: [
      /node\-bright\-sdk.node_modules/
    ]
  })
}

async function copyFiles() {
  await fs.promises.copyFile('node_modules/create-desktop-shortcuts/src/windows.vbs', 'www/nodejs/dist/windows.vbs').catch(console.error)
  await fs.promises.mkdir('www/nodejs/dist/moment-locale', {recursive: true}).catch(console.error)
  for(const file of (await fs.promises.readdir('node_modules/moment/dist/locale'))) {
    let err
    const content = await fs.promises.readFile('node_modules/moment/dist/locale/'+ file).catch(e => err = e)
    if(err) {
      console.error(err)
    } else {
      await fs.promises.writeFile('www/nodejs/dist/moment-locale/'+ file, String(content).
        replace('import moment from \'../moment\';', ''). // will use global moment
        replace('export default', 'module.exports =')
      ).catch(console.error)
    }
  }  
}

await copyFiles().catch(console.error)

export default outputs