import fs from 'fs';
import path from 'path';
import terser from '@rollup/plugin-terser';
import svelte from 'rollup-plugin-svelte';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import builtins from 'rollup-plugin-node-builtins';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';
import copy from 'rollup-plugin-copy';
import { sveltePreprocess } from 'svelte-preprocess';
import { babel, getBabelOutputPlugin } from '@rollup/plugin-babel';

// import config Babel via import ESM
import babelConfig from './babel.config.json' with { type: 'json' };
import babelRendererOutput from './babel.renderer-output.json' with { type: 'json' };
import babelRendererPolyfills from './babel.renderer-polyfills.json' with { type: 'json' };

// determines environment
const isProd = process.env.NODE_ENV === 'production';
const baseResolveOpts = { browser: false, preferBuiltins: true };

// common plugins
const replaceOpts = {
  preventAssignment: false,
  delimiters: ['', ''],
  values: {
    'fs/promises")': 'fs").promises',
    "fs/promises')": "fs').promises",
    'getFilename()': '__filename',
    'getDirname()': '__dirname',
    'require("electron")': 'process.platform=="android"?{}:require("electron")'
  }
}
const commonPlugins = [
  resolve(baseResolveOpts),
  commonjs({ sourcemap: false }),
  json({ compact: true }),
  replace(replaceOpts),
  terser({ ecma: 2018, maxWorkers: 4, keep_classnames: true, keep_fnames: true, output: { comments: false } })
];

// Svelte renderer plugins
const rendererPlugins = [
  svelte({
    emitCss: false,
    preprocess: sveltePreprocess(),
    compilerOptions: { css: 'injected', compatibility: { componentApi: 4 } }
  }),
  babel({ ...babelRendererPolyfills, babelHelpers: 'runtime', extensions: ['.js', '.svelte'], skipPreflightCheck: true }),
  resolve({ browser: true, exportConditions: ['node','svelte'], extensions: ['.svelte'], preferBuiltins: false }),
  commonjs({ sourcemap: true }),
  builtins(),
  getBabelOutputPlugin({ ...babelRendererOutput, allowAllFormats: true }),
  json({ compact: true }),
  terser()
];

const watchOpts = { buildDelay: 3000, exclude: 'node_modules/**' };
const external = [
  'electron',
  /@?electron\/?/,
  /.+\.(node|native)$/,
  /premium\./
];
const outputs = [];

// helper for Node.js bundles
function makeNodeBundle({ input, output, babelOpts, extraPlugins = [], externals = null }) {
  const plugins = [
    resolve(baseResolveOpts),
    commonjs({ sourcemap: true }),
    json({ compact: true }),
    getBabelOutputPlugin(babelOpts),
    replace(replaceOpts),    
    ...extraPlugins,
    terser({
      ecma: 2023,
      maxWorkers: 4,
      keep_classnames: true,
      keep_fnames: true,
      output: { comments: false }
    })
  ];
  outputs.push({
    input,
    output,
    plugins,
    external: Array.isArray(externals) ? externals : external,
    watch: watchOpts
  });
}

// App.svelte and capacitor
outputs.push(
  {
    input: 'www/nodejs/renderer/src/App.svelte',
    output: { dir: 'www/nodejs/renderer/dist', entryFileNames: 'App.js', format: 'iife', name: 'App', inlineDynamicImports: true, sourcemap: true },
    plugins: rendererPlugins,
    watch: watchOpts,
    external: ['electron', /@?electron\/?/, /.+\.(node|native)$/]
  },
  {
    input: { capacitor: 'capacitor.mjs' },
    output: { dir: 'www/nodejs/renderer/dist', entryFileNames: 'capacitor.js', format: 'iife', name: 'capacitor', inlineDynamicImports: true, sourcemap: true },
    plugins: rendererPlugins,
    watch: watchOpts,
    external: ['electron', /@?electron\/?/, /.+\.(node|native)$/]
  }
);

// Babel config import
// bundles main, preload e workers
const baseBabelOpts = babelConfig;

makeNodeBundle({
  input: 'www/nodejs/main.mjs',
  output: { format: 'esm', file: 'www/nodejs/dist/main.js', inlineDynamicImports: true, sourcemap: true },
  babelOpts: baseBabelOpts,
  extraPlugins: [
    copy({ targets: [
      { src: 'node_modules/dayjs/locale/*.js', dest: 'www/nodejs/dist/dayjs-locale' },
      { src: 'node_modules/create-desktop-shortcuts/src/windows.vbs', dest: 'www/nodejs/dist' },
      { src: 'node_modules/hls.js/dist/hls.min.js', dest: 'www/nodejs/renderer/dist' },
      { src: 'node_modules/mpegts.js/dist/mpegts.js', dest: 'www/nodejs/renderer/dist' },
      { src: 'node_modules/dashjs/dist/dash.all.min.js', dest: 'www/nodejs/renderer/dist' }
    ] })
  ]
});

[
  'preload.mjs',
  'modules/lists/updater-worker.js',
  'modules/lists/epg-worker.js',
  'modules/streamer/utils/mpegts-processor-worker.js',
  'modules/multi-worker/worker.mjs'
].forEach(file => {
  makeNodeBundle({
    input: `www/nodejs/${file}`,
    output: { format: 'cjs', file: `www/nodejs/dist/${path.basename(file).replace('.mjs','.js')}`, inlineDynamicImports: true, sourcemap: true },
    babelOpts: baseBabelOpts
  });
});

if (fs.existsSync('www/nodejs/modules/premium/premium.js')) {
  makeNodeBundle({
    input: 'www/nodejs/modules/premium/premium.js',
    output: { format: 'cjs', file: 'www/nodejs/dist/premium.js', inlineDynamicImports: true, sourcemap: true },
    babelOpts: baseBabelOpts,
    externals: ['electron', /@?electron\/?/, /.+\.(node|native)$/]
  });
}

export default outputs;
