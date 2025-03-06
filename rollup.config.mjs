import fs from 'fs';
import path from 'path';
import terser from '@rollup/plugin-terser';
import svelte from 'rollup-plugin-svelte';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import builtins from 'rollup-plugin-node-builtins';
import json from '@rollup/plugin-json';
import css from 'rollup-plugin-import-css';
import sveltePreprocess from 'svelte-preprocess';
import { babel, getBabelOutputPlugin } from '@rollup/plugin-babel';
import babelConfig from './babel.config.json' with { type: 'json' };
import babelRendererOutput from './babel.renderer-output.json' with { type: 'json' };
import babelRendererPolyfills from './babel.renderer-polyfills.json' with { type: 'json' };
import replace from '@rollup/plugin-replace';
import copy from 'rollup-plugin-copy';
import createRequire from 'create-require';

const require = createRequire(import.meta.url);
const resolveSync = require('resolve').sync;

const commonResolve = resolve({
  browser: false,
  preferBuiltins: true
});
const commonCommonjs = commonjs({ sourceMap: false });
const commonJson = json({ compact: true });
const commonReplace = replace({
  preventAssignment: false,
  delimiters: ['', ''],
  values: {
    'fs/promises")': 'fs").promises',
    'fs/promises\')': 'fs\').promises',
    '\'node:': '\'',
    '"node:': '"',
    'getFilename()': '__filename',
    'getDirname()': '__dirname',
    'require("electron")': 'process.platform=="android"?{}:require("electron")'
  }
});
const commonTerser = terser({
  ecma: 2018,
  maxWorkers: 4,
  keep_classnames: true,
  keep_fnames: true,
  output: { comments: false }
});

function createBasePlugins() {
  return [
    commonResolve,
    commonCommonjs,
    commonJson,
    getBabelOutputPlugin(babelConfig),
    commonReplace,
    commonTerser
  ];
}

function createMainPlugins() {
  return [
    resolve({ browser: false, preferBuiltins: true }),
    commonCommonjs,
    copy({
      targets: [
        { src: 'node_modules/dayjs/locale/*.js', dest: 'www/nodejs/dist/dayjs-locale' },
        { src: 'node_modules/create-desktop-shortcuts/src/windows.vbs', dest: 'www/nodejs/dist' }
      ]
    }),
    commonJson,
    getBabelOutputPlugin(babelConfig),
    commonReplace,
    commonTerser
  ];
}

function createPremiumPlugins() {
  return [
    resolve({ browser: false, preferBuiltins: true }),
    commonCommonjs,
    commonJson,
    getBabelOutputPlugin(babelConfig),
    commonReplace,
    commonTerser
  ];
}

function customResolve(options = {}) {
  const { basedir = process.cwd() } = options;
  return {
    name: 'custom-resolve',
    resolveId(source, importer) {
      const currentDir = importer ? path.dirname(importer) : basedir;
      const exts = ['', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json'];
      const exists = path => fs.existsSync(path);
      const isFile = path => exists(path) && fs.lstatSync(path).isFile();
      let debug = {}
      if (isFile(source)) {
        return source;
      }
      try {
        const resolved = resolve.sync(source, { basedir });
        return resolved;
      } catch (error) {
        try {
          const resolved = resolve.sync(source, { basedir: currentDir });
          return resolved;
        } catch (error) {
          if (source.startsWith('.')) {
            const resolved = path.join(currentDir, source);
            if (exists(path.dirname(resolved))) {
              source = resolved;
            }
          } else {
            const resolved = exists(source) ? source : path.join(currentDir, source);
            if (exists(path.dirname(resolved))) {
              source = resolved;
            }
          }

          let packageName = source;
          let subpath = '';
          if (source.startsWith('@')) {
            // Para pacotes scoped, o nome é os dois primeiros segmentos
            const parts = source.split('/');
            if (parts.length >= 2) {
              packageName = parts.slice(0, 2).join('/');
              subpath = parts.slice(2).join('/');
            }
          } else {
            const parts = source.split('/');
            packageName = parts[0];
            subpath = parts.slice(1).join('/');
          }

          const packagePath = path.join(basedir, 'node_modules', packageName);
          const packageJsonPath = path.join(packagePath, 'package.json');
          debug.packageJsonPath = packageJsonPath;
          debug.packagePath = packagePath;
          if (exists(packageJsonPath)) {
            try {
              const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
              debug.pkg = pkg;
              if (pkg.exports) {
                const exportKey = subpath ? `./${subpath}` : '.';
                let mapping = pkg.exports[exportKey];
                let target;
                if (typeof mapping === 'string') {
                  target = mapping;
                } else if (mapping && mapping.default) {
                  target = mapping.default;
                }
                if (target) {
                  const resolved = path.join(packagePath, target);
                  return resolved;
                }
              }
              if (pkg.module) {
                const resolved = path.join(packagePath, pkg.module);
                if (isFile(resolved)) {
                  return resolved;
                }
              }
              if (pkg.main) {
                const resolved = path.join(packagePath, pkg.main);
                if (isFile(resolved)) {
                  return resolved;
                }
              }
            } catch (e) { }
          }

          for (const ext of exts) {
            if (isFile(source + ext)) {
              return source + ext;
            }
          }
        }
      }
      return null;
    }
  }
}

const pluginsRenderer = [
  svelte({ preprocess: sveltePreprocess() }),
  babel({
    ...babelRendererPolyfills,
    babelHelpers: 'runtime',
    extensions: ['.js', '.svelte'],
    skipPreflightCheck: true
  }),
  resolve({
    browser: true,
    exportConditions: ['node', 'svelte'],
    extensions: ['.svelte'],
    preferBuiltins: false
  }),
  customResolve(),
  builtins(),
  commonjs(),
  getBabelOutputPlugin({ ...babelRendererOutput, allowAllFormats: true }),
  commonJson,
  css({ output: 'renderer.css' }),
  terser({
    ecma: 2015,
    maxWorkers: 4,
    keep_classnames: true,
    keep_fnames: true,
    output: { comments: false }
  })
];

const outputs = [
  {
    input: { renderer: 'www/nodejs/renderer/src/App.svelte' },
    output: {
      dir: 'www/nodejs/renderer/dist',
      format: 'iife',
      name: 'App',
      inlineDynamicImports: true
    },
    plugins: pluginsRenderer
  },
  {
    input: { capacitor: 'capacitor.js' },
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
    plugins: createMainPlugins(),
    external: [/(@?electron\/?)/, /premium\./]
  },
  {
    input: 'www/nodejs/preload.mjs',
    output: {
      format: 'cjs',
      file: 'www/nodejs/dist/preload.js',
      name: 'preload',
      inlineDynamicImports: true
    },
    plugins: createBasePlugins(),
    external: [/(@?electron\/?)/]
  },
  {
    input: 'www/nodejs/modules/lists/updater-worker.js',
    output: {
      format: 'cjs',
      file: 'www/nodejs/dist/updater-worker.js',
      inlineDynamicImports: true
    },
    plugins: createBasePlugins(),
    external: []
  },
  {
    input: 'www/nodejs/modules/lists/epg-worker.js',
    output: {
      format: 'cjs',
      file: 'www/nodejs/dist/epg-worker.js',
      inlineDynamicImports: true
    },
    plugins: createBasePlugins(),
    external: []
  },
  {
    input: 'www/nodejs/modules/streamer/utils/mpegts-processor-worker.js',
    output: {
      format: 'cjs',
      file: 'www/nodejs/dist/mpegts-processor-worker.js',
      inlineDynamicImports: true
    },
    plugins: createBasePlugins(),
    external: []
  },
  {
    input: 'www/nodejs/modules/multi-worker/worker.mjs',
    output: {
      format: 'cjs',
      file: 'www/nodejs/dist/worker.js',
      inlineDynamicImports: true
    },
    plugins: createBasePlugins(),
    external: []
  }
];

if (fs.existsSync('www/nodejs/modules/premium/premium.js')) {
  outputs.push({
    input: 'www/nodejs/modules/premium/premium.js',
    output: {
      format: 'cjs',
      file: 'www/nodejs/dist/premium.js',
      inlineDynamicImports: true
    },
    plugins: createPremiumPlugins(),
    external: [/node\-bright\-sdk.node_modules/]
  });
}

export default outputs;
