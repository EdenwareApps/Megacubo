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
import gzipPlugin from 'rollup-plugin-gzip';
import { sveltePreprocess } from 'svelte-preprocess';
import { babel, getBabelOutputPlugin } from '@rollup/plugin-babel';

// import config Babel via import ESM
import babelConfig from './babel.config.json' with { type: 'json' };
import babelRendererOutput from './babel.renderer-output.json' with { type: 'json' };
import babelRendererPolyfills from './babel.renderer-polyfills.json' with { type: 'json' };

// Performance optimization: conditional source maps
const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';

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

// Performance optimization: enhanced terser configuration
const terserConfig = {
  ecma: 2023,
  maxWorkers: 4,
  keep_classnames: true,
  keep_fnames: true,
  output: { comments: false },
  compress: {
    drop_console: isProduction,
    drop_debugger: isProduction,
    pure_funcs: isProduction ? ['console.log', 'console.warn'] : []
  }
};

// Svelte renderer plugins
const rendererPlugins = [
  svelte({
    emitCss: false,
    preprocess: sveltePreprocess(),
    compilerOptions: { css: 'injected', compatibility: { componentApi: 4 } }
  }),
  babel({ ...babelRendererPolyfills, babelHelpers: 'runtime', extensions: ['.js', '.svelte'], skipPreflightCheck: true }),
  resolve({ browser: true, exportConditions: ['node', 'svelte', 'import', 'default'], extensions: ['.svelte'], preferBuiltins: false }),
  commonjs({ sourcemap: isDevelopment }),
  builtins(),
  getBabelOutputPlugin({ ...babelRendererOutput, allowAllFormats: true }),
  json({ compact: true }),
  terser(terserConfig),
  // Performance optimization: Add gzip compression for production
  ...(isProduction ? [gzipPlugin()] : [])
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

// Performance optimization: selective locale copying
const getRequiredLocales = () => {
  // In a real implementation, this would analyze the codebase to determine used locales
  // For now, return a smaller subset of commonly used locales
  const commonLocales = ['en', 'es', 'fr', 'de', 'pt', 'pt-br', 'it', 'ru', 'zh', 'ja', 'ko'];
  return commonLocales.map(locale => `node_modules/dayjs/locale/${locale}.js`);
};

// helper for Node.js bundles
function makeNodeBundle({ input, output, babelOpts, extraPlugins = [], externals = null }) {
  const plugins = [
    resolve({
      ...baseResolveOpts,
      // Performance optimization: enable tree shaking
      exportConditions: ['import', 'module', 'default']
    }),
    commonjs({ 
      sourcemap: isDevelopment,
      // Performance optimization: better tree shaking
      transformMixedEsModules: true
    }),
    json({ compact: true }),
    getBabelOutputPlugin(babelOpts),
    replace(replaceOpts),    
    ...extraPlugins,
    terser(terserConfig),
    // Performance optimization: Add gzip compression for production
    ...(isProduction ? [gzipPlugin()] : [])
  ];

  // Performance optimization: conditional source maps and manual chunking
  const outputConfig = {
    ...output,
    sourcemap: isDevelopment,
    // Performance optimization: enable manual chunking for better caching
    ...(isProduction && {
      manualChunks: (id) => {
        // Split vendor libraries
        if (id.includes('node_modules')) {
          if (id.includes('svelte')) return 'svelte-vendor';
          if (id.includes('axios') || id.includes('undici')) return 'http-vendor';
          if (id.includes('dayjs')) return 'date-vendor';
          if (id.includes('hls.js') || id.includes('mpegts.js') || id.includes('dashjs')) return 'video-vendor';
          return 'vendor';
        }
        // Split large modules
        if (id.includes('modules/streamer')) return 'streamer';
        if (id.includes('modules/lists')) return 'lists';
        if (id.includes('modules/channels')) return 'channels';
      }
    })
  };

  outputs.push({
    input,
    output: outputConfig,
    plugins,
    external: Array.isArray(externals) ? externals : external,
    watch: watchOpts,
    // Performance optimization: enable tree shaking
    treeshake: {
      moduleSideEffects: false,
      propertyReadSideEffects: false,
      unknownGlobalSideEffects: false
    }
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
      sourcemap: isDevelopment 
    },
    plugins: rendererPlugins,
    watch: watchOpts,
    external: ['electron', /.+\.(node|native)$/],
    treeshake: {
      moduleSideEffects: false,
      propertyReadSideEffects: false,
      unknownGlobalSideEffects: false
    }
  },
  {
    input: { capacitor: 'capacitor.mjs' },
    output: { 
      dir: 'www/nodejs/renderer/dist', 
      entryFileNames: 'capacitor.js', 
      format: 'iife', 
      name: 'capacitor', 
      inlineDynamicImports: true, 
      sourcemap: isDevelopment 
    },
    plugins: rendererPlugins,
    watch: watchOpts,
    external: ['electron', /.+\.(node|native)$/],
    treeshake: {
      moduleSideEffects: false,
      propertyReadSideEffects: false,
      unknownGlobalSideEffects: false
    }
  }
);

makeNodeBundle({
  input: 'www/nodejs/main.mjs',
  output: { 
    format: 'esm', 
    file: 'www/nodejs/dist/main.js', 
    inlineDynamicImports: !isProduction, // Enable chunking in production
    sourcemap: isDevelopment 
  },
  babelOpts: baseBabelOpts,
  extraPlugins: [
    copy({ 
      targets: [
        // Performance optimization: copy only required locales
        ...(isProduction 
          ? getRequiredLocales().map(src => ({ src, dest: 'www/nodejs/dist/dayjs-locale' }))
          : [{ src: 'node_modules/dayjs/locale/*.js', dest: 'www/nodejs/dist/dayjs-locale' }]
        ),
        { src: 'node_modules/create-desktop-shortcuts/src/windows.vbs', dest: 'www/nodejs/dist' },
        // Performance optimization: copy video libraries to separate chunk directory  
        { src: 'node_modules/hls.js/dist/hls.min.js', dest: 'www/nodejs/renderer/dist' },
        { src: 'node_modules/mpegts.js/dist/mpegts.js', dest: 'www/nodejs/renderer/dist' },
        { src: 'node_modules/dashjs/dist/dash.all.min.js', dest: 'www/nodejs/renderer/dist' }
      ] 
    })
  ]
});

makeNodeBundle({
  input: 'www/nodejs/electron.mjs',
  output: { 
    format: 'cjs', 
    file: 'www/nodejs/dist/electron.js', 
    inlineDynamicImports: true, 
    sourcemap: isDevelopment 
  },
  babelOpts: baseBabelOpts,
  externals: ['electron', /.+\.(node|native)$/]
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
    output: { 
      format: 'cjs', 
      file: `www/nodejs/dist/${path.basename(file).replace('.mjs','.js')}`, 
      inlineDynamicImports: true, 
      sourcemap: isDevelopment 
    },
    babelOpts: baseBabelOpts,
    externals: ['electron', /.+\.(node|native)$/]
  });
});

if (fs.existsSync('www/nodejs/modules/premium/premium.js')) {
  makeNodeBundle({
    input: 'www/nodejs/modules/premium/premium.js',
    output: { 
      format: 'cjs', 
      file: 'www/nodejs/dist/premium.js', 
      inlineDynamicImports: true, 
      sourcemap: isDevelopment 
    },
    babelOpts: baseBabelOpts,
    externals: ['electron', /.+\.(node|native)$/]
  });
}

export default outputs;
