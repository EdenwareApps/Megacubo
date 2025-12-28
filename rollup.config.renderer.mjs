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
import babelNodeOutput from './babel.node-output.json' with { type: 'json' };
import babelRendererOutput from './babel.renderer-output.json' with { type: 'json' };
import babelRendererPolyfills from './babel.renderer-polyfills.json' with { type: 'json' };

// determines environment
const baseResolveOpts = { browser: false, exportConditions: ['node', 'svelte'], preferBuiltins: true };

// common plugins
const replaceOpts = {
  preventAssignment: false,
  delimiters: ['', ''],
  values: {
    'fs/promises")': 'fs").promises',
    "fs/promises')": "fs').promises",
    'getFilename()': '__filename',
    'getDirname()': '__dirname'
  }
}

// Check if this is a production build
const isProduction = process.env.NODE_ENV === 'production' || process.argv.includes('--production')

// Svelte renderer plugins
const rendererPlugins = [
  svelte({
    emitCss: false,
    preprocess: sveltePreprocess(),
    compilerOptions: { css: 'injected', compatibility: { componentApi: 4 } }
  }),
  babel({ ...babelRendererPolyfills, babelHelpers: 'bundled', extensions: ['.js', '.svelte'], skipPreflightCheck: true }),
  resolve({
    browser: true,
    exportConditions: ['svelte', 'node', 'import', 'default'],
    extensions: ['.js', '.mjs', '.json', '.svelte'],
    preferBuiltins: false,
  }),
  commonjs({
    include: [
      'node_modules/**',
      'www/nodejs/modules/**'
    ],
    extensions: ['.js', '.cjs']
  }),
  json(),
  builtins(),
  replace(replaceOpts),
  isProduction && terser({
    compress: {
      drop_console: false,
      drop_debugger: true,
      pure_funcs: ['console.debug']
    }
  })
].filter(Boolean);

// Watch options
const watchOpts = {
  include: ['www/nodejs/renderer/src/**', 'www/nodejs/modules/**'],
  exclude: ['node_modules/**']
};

// Main Svelte app
export default {
  input: 'www/nodejs/renderer/src/App.svelte',
  output: {
    file: 'www/nodejs/renderer/dist/App.js',
    format: 'iife',
    name: 'App',
    sourcemap: !isProduction
  },
  plugins: rendererPlugins,
  watch: watchOpts,
  external: ['electron', /.+\.(node|native)$/]
};

// Copy static assets (executed separately)
if (isProduction || process.argv.includes('--copy-assets')) {
  // This will be handled by a separate script or manual copy
}
