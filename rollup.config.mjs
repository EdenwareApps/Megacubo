import terser from '@rollup/plugin-terser'
import svelte from 'rollup-plugin-svelte'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import builtins from 'rollup-plugin-node-builtins'
import json from '@rollup/plugin-json'
import css from 'rollup-plugin-import-css'
import sveltePreprocess from 'svelte-preprocess'
import { getBabelOutputPlugin } from '@rollup/plugin-babel';
import babelConfig from './babel.config.json' assert { type: 'json'};
import replace from '@rollup/plugin-replace';
import protobuf from 'protobufjs';

const proto = {
  name: 'proto-loader',
  async resolveId(source, importer) {
    if (source.endsWith('.proto')) {
      return source;
    }
    return null;
  },
  async load(id) {
    if (id.endsWith('.proto')) {
      const protoFilePath = id.replace(/^\0/, '');
      const protoDefinition = await protobuf.load(protoFilePath);
      return `export default ${JSON.stringify(protoDefinition)};`;
    }
    return null;
  }
}

const plugins = [
  resolve({
    browser: false,
    preferBuiltins: true
  }),
  commonjs(),
  proto,
  json(),
  getBabelOutputPlugin(babelConfig),
  terser({
    keep_classnames: true,
    keep_fnames: true,
    output: {
      comments: false
    }
  }),
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
      'require("electron")': 'process.platform=="android"?{}:require("electron")' // dummy value for Android
    }
  })
]

export default [
  {
    input: 'www/nodejs/main.mjs',
    output: {
      format: 'esm',
      file: 'www/nodejs/dist/main.cjs',
      inlineDynamicImports: true
    },
    plugins,
    external: [
      /(@?electron\/?)/,
      'node-bright-sdk'
    ]
  },
  {
    input: {
      'capacitor': 'capacitor.mjs'
    },
    output: {
      dir: 'www/nodejs/renderer/dist',
      format: 'iife',
      name: 'capacitor',
      inlineDynamicImports: true
    },
    plugins: [
      resolve({
        browser: true
      }),
      builtins(),
      commonjs(),
      json(),
      terser({
        keep_classnames: true,
        keep_fnames: true,
        output: {
          comments: false
        }
      })
    ]
  },
  {
    input: {
      renderer: 'www/nodejs/renderer/src/App.svelte'
    },
    output: {
      dir: 'www/nodejs/renderer/dist',
      format: 'iife',
      name: 'App'
    },
    plugins: [
      svelte({        
        preprocess: sveltePreprocess()
      }),
      resolve({
        browser: true,
        exportConditions: ['svelte'],
        extensions: ['.svelte']
      }),
      builtins(),
      commonjs(),
      json(),
      css({
        output: 'renderer.css'
      }),
      terser({
        keep_fnames: true,
        output: {
          comments: false
        }
      })
    ]
  },
  {
    input: 'www/nodejs/preload.mjs',
    output: {
      format: 'cjs',
      file: 'www/nodejs/dist/preload.cjs',
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
    external: [
      /(@?electron\/?)/
    ]
  },
  {
    input: 'www/nodejs/modules/jimp-worker/jimp-worker.js',
    output: {
      format: 'cjs',
      file: 'www/nodejs/dist/jimp-worker.js',
      inlineDynamicImports: true
    },
    plugins,
    external: [
      /(@?electron\/?)/
    ]
  },
  {
    input: 'www/nodejs/modules/lists/epg-worker.js',
    output: {
      format: 'cjs',
      file: 'www/nodejs/dist/epg-worker.js',
      inlineDynamicImports: true
    },
    plugins,
    external: [
      /(@?electron\/?)/
    ]
  },
  {
    input: 'www/nodejs/modules/streamer/utils/mpegts-processor-worker.js',
    output: {
      format: 'cjs',
      file: 'www/nodejs/dist/mpegts-processor-worker.js',
      inlineDynamicImports: true
    },
    plugins,
    external: [
      /(@?electron\/?)/
    ]
  },
  {
    input: 'www/nodejs/modules/multi-worker/worker.mjs',
    output: {
      format: 'cjs',
      file: 'www/nodejs/dist/worker.js',
      inlineDynamicImports: true
    },
    plugins,
    external: [
      /(@?electron\/?)/
    ]
  }
]
