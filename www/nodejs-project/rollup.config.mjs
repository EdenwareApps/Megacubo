import terser from '@rollup/plugin-terser'
import svelte from 'rollup-plugin-svelte'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import builtins from 'rollup-plugin-node-builtins'
import json from '@rollup/plugin-json'
import css from 'rollup-plugin-import-css'
import globals from 'rollup-plugin-node-globals'
import sveltePreprocess from 'svelte-preprocess'

export default [
  /*
  // I've tried here to bundle main process scripts too but it seems to get problematic with __dirname inside modules. :/
	{
		input: 'main.js',
		output: [
			{ file: 'main-bundle.js', format: 'cjs' }
		],
    plugins: [
      resolve(),
      commonjs(),
      json()
    ],
    external: [
      /(premium\/)/,
      /(electron\/)/,
      /node_modules/,
      'cordova',
      'electron'
    ]
	}
  */
  {
    input: {
      renderer: 'renderer/src/App.svelte'
    },
    output: {
      dir: 'renderer/dist',
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
        // keep_classnames: true,
        keep_fnames: true,
        output: {
          comments: false
        }
      })
    ]
  }
]
