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
  babel({ ...babelRendererPolyfills, babelHelpers: 'runtime', extensions: ['.js', '.svelte'], skipPreflightCheck: true }),
  resolve({ browser: true, exportConditions: ['node', 'svelte', 'import', 'default'], extensions: ['.svelte'], preferBuiltins: false }),
  commonjs({ sourcemap: true }),
  builtins(),
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
        })] : [])
];

// Babel config import
// bundles main, preload e workers
const baseBabelOpts = babelConfig;
const watchOpts = { buildDelay: 3000, exclude: 'node_modules/**' };
const external = [
  'electron',
  /.+\.(node|native)$/,
  /premium\./
];
const outputs = [];

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
          maxWorkers: 1,
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
        })] : [])
  ];
  outputs.push({
    input,
    output,
    plugins,
    external: Array.isArray(externals) ? externals : external,
    watch: watchOpts,
    maxParallelFileOps: isLargeFile || isMainProcess ? 1 : undefined, // Forçar 1 para main process
    treeshake: isLargeFile || isMainProcess ? false : undefined, // Desabilitar para main process
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
  output: { format: 'cjs', file: 'www/nodejs/dist/main.js', inlineDynamicImports: true, sourcemap: false }, // Desabilitar sourcemap para main process
  babelOpts: baseBabelOpts,
  isMainProcess: true, // Ativar otimizações específicas para main process
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

makeNodeBundle({
  input: 'www/nodejs/electron.mjs',
  output: { format: 'cjs', file: 'www/nodejs/dist/electron.js', inlineDynamicImports: true, sourcemap: true },
  babelOpts: baseBabelOpts,
  externals: ['electron', /.+\.(node|native)$/]
});

[
  'preload.mjs',
  'modules/lists/updater-worker.js',
  'modules/epg-worker/EPGManager.js',
  'modules/streamer/utils/mpegts-processor-worker.js',
  'modules/multi-worker/worker.mjs'
].forEach(file => {
  const outputFile = path.basename(file).replace('.mjs','.js');
  const isLargeFile = file.includes('EPGManager.js');
  makeNodeBundle({
    input: `www/nodejs/${file}`,
    output: { format: 'cjs', file: `www/nodejs/dist/${outputFile}`, inlineDynamicImports: true, sourcemap: true },
    babelOpts: baseBabelOpts,
    externals: ['electron', /.+\.(node|native)$/],
    isLargeFile
  });
});

if (fs.existsSync('www/nodejs/modules/premium/premium.js')) {
  makeNodeBundle({
    input: 'www/nodejs/modules/premium/premium.js',
    output: { format: 'cjs', file: 'www/nodejs/dist/premium.js', inlineDynamicImports: true, sourcemap: true },
    babelOpts: baseBabelOpts,
    externals: ['electron', /.+\.(node|native)$/]
  });
}

export default outputs;
