import fs from 'fs';
import path from 'path';
import terser from '@rollup/plugin-terser';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';
import copy from 'rollup-plugin-copy';
import { getBabelOutputPlugin } from '@rollup/plugin-babel';
import gcPlugin from './scripts/rollup-gc-plugin.mjs';

// import config Babel via import ESM
import babelConfig from './babel.config.json' with { type: 'json' };
import babelNodeOutput from './babel.node-output.json' with { type: 'json' };

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
        return '\0node:sqlite'; // Virtual module ID (null-byte prefix)
      }
      return null;
    },
    load(id) {
      // Return mock module when virtual ID is loaded
      // This replaces require('node:sqlite') with a mock implementation
      if (id === '\0node:sqlite') {
        return `
// Mock module for node:sqlite (not available on Android)
class DatabaseSync {
  constructor() {}
  close() {}
  prepare() {
    return {
      run: () => {},
      get: () => null,
      all: () => []
    };
  }
}

class StatementSync {}

function openSync() {
  throw new Error('SQLite not available on Android');
}

// Support both ESM and CommonJS
exports.DatabaseSync = DatabaseSync;
exports.StatementSync = StatementSync;
exports.openSync = openSync;
module.exports = { DatabaseSync, StatementSync, openSync };
`;
      }
      return null;
    }
  };
}

// helper for Node.js bundles
function makeNodeBundle({ input, output, babelOpts, extraPlugins = [], externals = null, isLargeFile = false, isMainProcess = false }) {
  // Configurações específicas para main process
  const mainProcessConfig = isMainProcess ? {
    maxWorkers: 1, // Reduzir workers para economizar memória
    keep_classnames: false, // Desabilitar para economizar memória
    keep_fnames: false, // Desabilitar para economizar memória
    compress: {
      drop_console: true, // Remover console logs para economizar memória
      drop_debugger: true,
      passes: 1,
      unsafe: true, // Otimizações mais agressivas
      unsafe_comps: true,
      unsafe_math: true
    }
  } : {
    maxWorkers: 2,
    keep_classnames: true,
    keep_fnames: true,
    compress: {
      drop_console: false,
      drop_debugger: false,
      passes: 1
    }
  };

  const plugins = [
    sqliteResolvePlugin(), // Resolve node:sqlite to mock module (must be before resolve)
    resolve({
      ...baseResolveOpts,
      // Configurações específicas para main process
      ...(isMainProcess ? { dedupe: [] } : {})
    }),
    commonjs({ 
      sourcemap: isMainProcess ? false : true, // Desabilitar sourcemap para main process
      ...(isMainProcess ? { requireReturnsDefault: 'auto' } : {})
    }),
    json({ compact: true }),
    getBabelOutputPlugin({
      ...babelOpts,
      // Otimizações de memória para main process
      ...(isMainProcess ? { compact: true, minified: true } : {})
    }),
    replace(replaceOpts),    
    ...extraPlugins,
    // Enable terser for production builds with BigInt-safe settings
        ...(isProduction && !isLargeFile ? [terser({
          ecma: 2020, // Use ECMAScript 2020 for better BigInt compatibility
          maxWorkers: 0, // Disable workers to prevent hanging
          keep_classnames: true, // Keep class names to avoid BigInt issues
          keep_fnames: true, // Keep function names to avoid BigInt issues
          output: { comments: false },
          compress: {
            drop_console: true,
            drop_debugger: true,
            passes: 1, // Reduce passes to avoid BigInt issues
            // ✅ APENAS as desativações essenciais para BigInt
            reduce_vars: false,     // ← Principal: evita reescrita de vars com BigInt
            evaluate: false,        // ← Principal: evita avaliação de expressões BigInt
            // Manter outras otimizações
            unsafe: false,
            unsafe_comps: false,
            unsafe_math: false,
            unsafe_proto: false,
            unsafe_regexp: false
          }
        })] : []),
    gcPlugin() // Add GC plugin at the end to run after bundle is written
  ];
  outputs.push({
    input,
    output,
    plugins,
    external: Array.isArray(externals) ? externals : external,
    watch: watchOpts,
    maxParallelFileOps: isLargeFile || isMainProcess ? 1 : undefined, // Forçar 1 para main process
    treeshake: isLargeFile ? false : (isMainProcess ? {
      // Tree shaking habilitado para main.js com configurações conservadoras
      moduleSideEffects: (id) => {
        // Preservar módulos que podem ter side effects importantes
        if (id.includes('analytics.js') || 
            id.includes('crashlog.js') ||
            id.includes('node-cleanup') ||
            id.includes('onexit')) {
          return true; // Preservar side effects
        }
        // Para módulos próprios, assumir que podem ter side effects (conservador)
        if (id.includes('www/nodejs/modules/') && !id.includes('node_modules')) {
          return true; // Preservar módulos próprios por segurança
        }
        // Para node_modules, tentar tree shaking (mais seguro)
        return false; // Permitir tree shaking em node_modules
      },
      propertyReadSideEffects: false, // Propriedades podem ser tree-shaken
      tryCatchDeoptimization: false // Não desotimizar try-catch
    } : undefined),
    // Configurações específicas para main process
    ...(isMainProcess ? {
      preserveEntrySignatures: 'allow-extension',
      onwarn(warning, warn) {
        // Suprimir warnings de dependências circulares para main process
        if (warning.code === 'CIRCULAR_DEPENDENCY') return;
        warn(warning);
      }
    } : {})
  });
}

// Node.js bundles only
makeNodeBundle({
  input: 'www/nodejs/main.mjs',
  output: { format: 'cjs', file: 'www/nodejs/dist/main.js', inlineDynamicImports: true, sourcemap: false }, // Desabilitar sourcemap para main process
  babelOpts: nodeBabelOpts,
  isMainProcess: true, // Ativar otimizações específicas para main process
  extraPlugins: [
    copy({ targets: [
      { src: 'node_modules/dayjs/locale/*.js', dest: 'www/nodejs/dist/dayjs-locale' },
      { src: 'node_modules/create-desktop-shortcuts/src/windows.vbs', dest: 'www/nodejs/dist' },
      { src: 'node_modules/hls.js/dist/hls.min.js', dest: 'www/nodejs/renderer/dist' },
      { src: 'node_modules/mpegts.js/dist/mpegts.js', dest: 'www/nodejs/renderer/dist' },
      { src: 'node_modules/bytenode/**/*', dest: 'www/nodejs/dist/node_modules/bytenode' },
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



