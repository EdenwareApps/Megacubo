// Cache invalidation 3
import fs from 'fs';
import path from 'path';
import terser from '@rollup/plugin-terser';
import svelte from 'rollup-plugin-svelte';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import polyfills from 'rollup-plugin-polyfill-node';
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
    resolveOnly: [] // Allow all modules to be resolved
  }),
  commonjs({ sourcemap: true }),
  polyfills(),
  getBabelOutputPlugin({ ...babelRendererOutput, allowAllFormats: true }),
  json({ compact: true }),
        ...(isProduction ? [terser({
          ecma: 2020, // Use ECMAScript 2020 for better BigInt compatibility
          maxWorkers: 2,
          keep_classnames: true, // Keep class names to avoid BigInt issues
          keep_fnames: true, // Keep function names to avoid BigInt issues
          output: { comments: false },
          compress: {
            drop_console: true,
            drop_debugger: true,
            passes: 1, // Reduce passes to avoid BigInt issues
            // ✅ ONLY essential disables for BigInt
            reduce_vars: false,     // ← Main: avoids rewriting vars with BigInt
            evaluate: false,        // ← Main: avoids evaluating BigInt expressions
            // Keep other optimizations
            unsafe: false,
            unsafe_comps: false,
            unsafe_math: false,
            unsafe_proto: false,
            unsafe_regexp: false
          }
        })] : [])
];

// Babel config import
// bundles main, preload e workers
const baseBabelOpts = babelConfig;
const nodeBabelOpts = babelNodeOutput;
const watchOpts = { buildDelay: 3000, exclude: 'node_modules/**' };
const external = [
  'electron',
  /.+\.(node|native)$/,
  /premium\./,
  'bytenode' // Must be external - modifies Node.js module system at runtime
];
const outputs = [];

// Plugin to resolve node:sqlite to a mock module (prevents external dependency warning)
function sqliteResolvePlugin() {
  return {
    name: 'sqlite-resolve',
    resolveId(source) {
      // Intercept node:sqlite and return virtual module ID
      if (source === 'node:sqlite') {
        return '\0node:sqlite2'; // Virtual module ID (null-byte prefix)
      }
      return null;
    },
    load(id) {
      // Return mock module when virtual ID is loaded
      // This replaces require('node:sqlite') with a mock implementation
      if (id === '\0node:sqlite2') {
        return `
// Mock module for node:sqlite (not available on Android)
// Updated mock
export default {};
`;
      }
      return null;
    }
  };
}

// helper for Node.js bundles
function makeNodeBundle({ input, output, babelOpts, extraPlugins = [], externals = null, isLargeFile = false, isMainProcess = false }) {
  // Specific settings for main process
  const mainProcessConfig = isMainProcess ? {
    maxWorkers: 1, // Reduce workers to save memory
    keep_classnames: false, // Disable to save memory
    keep_fnames: false, // Disable to save memory
    compress: {
      drop_console: isProduction, // Remove console logs in production
      drop_debugger: true,
      passes: 1,
      unsafe: true, // More aggressive optimizations
      unsafe_comps: true,
      unsafe_math: true
    }
  } : {
    maxWorkers: 2,
    keep_classnames: true,
    keep_fnames: true,
    compress: {
      drop_console: isProduction, // Keep console logs in development
      drop_debugger: false,
      passes: 1
    }
  };

  const plugins = [
    sqliteResolvePlugin(), // Resolve node:sqlite to mock module (must be before resolve)
    resolve({
      ...baseResolveOpts,
      // Specific settings for main process
      ...(isMainProcess ? { dedupe: [] } : {})
    }),
    commonjs({ 
      sourcemap: isMainProcess ? false : true, // Disable sourcemap for main process
      dynamicRequireTargets: [
        'node_modules/node-ssdp/lib/server.js',
        'node_modules/*/lib/server.js',
        'node_modules/**/lib/server.js',
        'www/nodejs/modules/premium/modules/cast/node_modules/node-ssdp/lib/server.js',
        'www/nodejs/modules/premium/modules/cast/node_modules/node-ssdp/lib/client.js',
        'www/nodejs/modules/premium/modules/cast/node_modules/node-ssdp/lib/index.js'
      ],
      ignoreDynamicRequires: true,
      ...(isMainProcess ? { requireReturnsDefault: 'auto' } : {})
    }),
    json({ compact: true }),
    getBabelOutputPlugin({
      ...babelOpts,
      // Memory optimizations for main process
      ...(isMainProcess ? { compact: true, minified: true } : {})
    }),
    replace(replaceOpts),    
    ...extraPlugins,
    // Enable terser for production builds with BigInt-safe settings
        ...(isProduction && !isLargeFile ? [terser({
          ecma: 2020, // Use ECMAScript 2020 for better BigInt compatibility
          maxWorkers: 1,
          keep_classnames: true, // Keep class names to avoid BigInt issues
          keep_fnames: true, // Keep function names to avoid BigInt issues
          output: { comments: false },
          compress: {
            drop_console: true,
            drop_debugger: true,
            passes: 1, // Reduce passes to avoid BigInt issues
            // ✅ ONLY essential disables for BigInt
            reduce_vars: false,     // ← Main: avoids rewriting vars with BigInt
            evaluate: false,        // ← Main: avoids evaluating BigInt expressions
            // Keep other optimizations
            unsafe: false,
            unsafe_comps: false,
            unsafe_math: false,
            unsafe_proto: false,
            unsafe_regexp: false
          }
        })] : [])
  ];
  outputs.push({
    input,
    output,
    plugins,
    external: Array.isArray(externals) ? externals : external,
    watch: watchOpts,
    maxParallelFileOps: isLargeFile || isMainProcess ? 1 : undefined, // Force 1 for main process
    treeshake: isLargeFile ? false : (isMainProcess ? {
      // Tree shaking enabled for main.js with conservative settings
      moduleSideEffects: (id) => {
        // Preserve modules that may have important side effects
        if (id.includes('analytics.js') || 
            id.includes('crashlog.js') ||
            id.includes('node-cleanup') ||
            id.includes('onexit')) {
          return true; // Preserve side effects
        }
        // For own modules, assume they may have side effects (conservative)
        if (id.includes('www/nodejs/modules/') && !id.includes('node_modules')) {
          return true; // Preserve own modules for safety
        }
        // For node_modules, try tree shaking (safer)
        return false; // Allow tree shaking in node_modules
      },
      propertyReadSideEffects: false, // Properties can be tree-shaken
      tryCatchDeoptimization: false // Do not deoptimize try-catch
    } : undefined),
    // Specific settings for main process
    ...(isMainProcess ? {
      preserveEntrySignatures: 'allow-extension',
      onwarn(warning, warn) {
        // Suppress circular dependency warnings for main process
        if (warning.code === 'CIRCULAR_DEPENDENCY') return;
        warn(warning);
      }
    } : {})
  });
}

// App.svelte and capacitor
outputs.push(
  {
    input: 'www/nodejs/renderer/src/App.svelte',
    output: { 
      dir: 'www/nodejs/renderer/dist', 
      entryFileNames: 'App.js', 
      format: 'iife', 
      name: 'App', 
      inlineDynamicImports: true, 
      sourcemap: true
    },
    plugins: rendererPlugins,
    watch: watchOpts,
    external: ['electron', /.+\.(node|native)$/]
  },
  {
    input: { capacitor: 'capacitor.mjs' },
    output: { 
      dir: 'www/nodejs/renderer/dist', 
      entryFileNames: 'capacitor.js', 
      format: 'iife', 
      name: 'capacitor', 
      inlineDynamicImports: true, 
      sourcemap: true
    },
    plugins: rendererPlugins,
    watch: watchOpts,
    external: ['electron', /.+\.(node|native)$/]
  }
);

makeNodeBundle({
  input: 'www/nodejs/main.mjs',
  output: { format: 'cjs', file: 'www/nodejs/dist/main.js', inlineDynamicImports: true, sourcemap: false }, // Disable sourcemap for main process
  babelOpts: nodeBabelOpts,
  isMainProcess: true, // Enable main-process specific optimizations
  extraPlugins: [
    copy({ targets: [
      { src: 'node_modules/dayjs/locale/*.js', dest: 'www/nodejs/dist/dayjs-locale' },
      { src: 'node_modules/create-desktop-shortcuts/src/windows.vbs', dest: 'www/nodejs/dist' },
      { src: 'node_modules/hls.js/dist/hls.min.js', dest: 'www/nodejs/renderer/dist' },
      { src: 'node_modules/mpegts.js/dist/mpegts.js', dest: 'www/nodejs/renderer/dist' },
    ] })
  ]
});

makeNodeBundle({
  input: 'www/nodejs/electron.mjs',
  output: { format: 'cjs', file: 'www/nodejs/dist/electron.js', inlineDynamicImports: true, sourcemap: true },
  babelOpts: nodeBabelOpts,
  externals: ['electron', /.+\.(node|native)$/]
});

[
  'preload.mjs',
  'modules/lists/updater-worker.js',
  'modules/epg/worker/EPGManager.js',
  'modules/streamer/utils/mpegts-processor-worker.js',
  'modules/multi-worker/worker.mjs'
].forEach(file => {
  const outputFile = path.basename(file).replace('.mjs','.js');
  const isLargeFile = file.includes('EPGManager.js');
  makeNodeBundle({
    input: `www/nodejs/${file}`,
    output: { format: 'cjs', file: `www/nodejs/dist/${outputFile}`, inlineDynamicImports: true, sourcemap: true },
    babelOpts: nodeBabelOpts,
    externals: ['electron', /.+\.(node|native)$/],
    isLargeFile
  });
});

if (fs.existsSync('www/nodejs/modules/premium/premium.js')) {
  makeNodeBundle({
    input: 'www/nodejs/modules/premium/premium.js',
    output: { format: 'cjs', file: 'www/nodejs/dist/premium.js', inlineDynamicImports: true, sourcemap: true },
    babelOpts: nodeBabelOpts,
    externals: ['electron', /.+\.(node|native)$/]
  });
}

export default outputs;
