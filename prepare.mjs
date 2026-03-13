import { execSync, spawn } from 'node:child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'
import packageJson from './package.json' with { type: 'json' }
import { computeHash, FileStore } from 'rollup-plugin-smart-cache'

// Get the current directory in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url))
// android\app\src\main\assets\public\nodejs
const targetDir = path.join(__dirname, 'android/app/src/main/assets/public/nodejs')

// Exit if appVersion is empty or invalid
if (!packageJson.version || !/^[0-9]+(\.[0-9]+)*$/.test(packageJson.version)) {
  console.error(`Invalid or empty appVersion: ${packageJson.version}`)
  process.exit(1)
}

console.log(`App version: ${packageJson.version}`)

// Prune .rollup-smart-cache so it does not grow indefinitely (plugin has no expiration)
try {
  execSync('node scripts/prune-rollup-cache.js 15 7', { stdio: 'pipe', cwd: __dirname })
} catch (_) {
  // ignore prune errors
}

// Copy @edenware/countries data/supplement.json so bundled main.js (run from www/nodejs/dist) can find it at www/nodejs/data/supplement.json
const copySupplementJson = () => {
  const src = path.join(__dirname, 'node_modules/@edenware/countries/data/supplement.json')
  const destDir = path.join(__dirname, 'www/nodejs/data')
  const dest = path.join(destDir, 'supplement.json')
  if (!fs.existsSync(src)) {
    console.warn('@edenware/countries data/supplement.json not found, skipping copy')
    return
  }
  fs.mkdirSync(destDir, { recursive: true })
  fs.copyFileSync(src, dest)
  console.log('Copied supplement.json to www/nodejs/data/')
}
copySupplementJson()

// Helper to run commands and handle errors
const runCommand = (command, description) => {
  try {
    execSync(command, { stdio: 'inherit' })
  } catch (error) {
    console.error(`${description} failed with code ${error.status}`)
    process.exit(error.status)
  }
}

// Pos sync cleanup
const removeUnusedFiles = () => {
  console.log('Removing unused files...')

  const distNodeModulesDir = path.join(targetDir, 'dist/node_modules')
  if (fs.existsSync(distNodeModulesDir)) fs.rmSync(distNodeModulesDir, { recursive: true, force: true })

  // remove .map files from dist
  const distMapFiles = fs.readdirSync(path.join(targetDir, 'dist')).filter(file => file.endsWith('.map'))
  distMapFiles.forEach(file => fs.unlinkSync(path.join(targetDir, 'dist', file)))

  // remove .map files from renderer/dist
  const rendererDistMapFiles = fs.readdirSync(path.join(targetDir, 'renderer/dist')).filter(file => file.endsWith('.map'))
  rendererDistMapFiles.forEach(file => fs.unlinkSync(path.join(targetDir, 'renderer/dist', file)))
}

const removeElectronForAndroid = () => {
  const targetMainPath = path.join(targetDir, 'dist/main.js')
  const fixedTargetMainPath = path.join(targetDir, 'dist/main-android.js')
  fs.unlinkSync(targetMainPath)
  fs.renameSync(fixedTargetMainPath, targetMainPath)
}

// Smart cache: walk directory and collect relative paths -> Buffer (forward slashes)
function walkDirForMap(dir, base, map) {
  if (!fs.existsSync(dir)) return
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    const rel = path.relative(base, full).replace(/\\/g, '/')
    if (e.isDirectory()) walkDirForMap(full, base, map)
    else if (e.isFile()) map.set(rel, fs.readFileSync(full))
  }
}

function readNodeOutputs() {
  const map = new Map()
  walkDirForMap(path.join(__dirname, 'www/nodejs/dist'), __dirname, map)
  walkDirForMap(path.join(__dirname, 'www/nodejs/renderer/dist'), __dirname, map)
  return map
}

function readRendererOutputs() {
  const map = new Map()
  walkDirForMap(path.join(__dirname, 'www/nodejs/renderer/dist'), __dirname, map)
  return map
}

function restoreFromCache(entry, projectRoot) {
  for (const [fileName, content] of entry.outputs) {
    const full = path.join(projectRoot, fileName)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
}

// Run Rollup builds sequentially (Node.js bundles first, then Renderer bundles)
// Set NODE_OPTIONS before running rollup to increase memory limit
const originalNodeOptions = process.env.NODE_OPTIONS

// Helper to run rollup as a promise
const runRollupAsync = (configFile, description) => {
  return new Promise((resolve, reject) => {
    console.log(`Starting ${description}...`)
    
    // Prepare environment with NODE_OPTIONS
    // Only add --max-old-space-size if not already present
    let nodeOptions = originalNodeOptions || ''
    if (!nodeOptions.includes('--max-old-space-size')) {
      nodeOptions = (nodeOptions ? `${nodeOptions} ` : '') + '--max-old-space-size=8192'
    }
    // Add --expose-gc to enable garbage collection in child process
    if (!nodeOptions.includes('--expose-gc')) {
      nodeOptions = (nodeOptions ? `${nodeOptions} ` : '') + '--expose-gc'
    }
    
    // Run rollup - handle Windows .cmd files properly
    const rollupBin = process.platform === 'win32'
      ? 'node_modules\\.bin\\rollup.cmd'
      : 'node_modules/.bin/rollup'

    const rollupProcess = spawn(rollupBin, ['-c', configFile], {
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        NODE_OPTIONS: nodeOptions,
        PATH: `${process.cwd()}\\node_modules\\.bin;${process.env.PATH}`
      }
    })

    // Add timeout to detect hangs (10 minutes)
    const timeout = setTimeout(() => {
      console.error(`${description} appears to be hung (timeout after 10 minutes). Killing process...`)
      rollupProcess.kill('SIGTERM')
      setTimeout(() => {
        if (!rollupProcess.killed) {
          rollupProcess.kill('SIGKILL')
        }
      }, 5000)
      reject(new Error(`${description} timed out after 10 minutes`))
    }, 600000) // 10 minutes

    rollupProcess.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        console.log(`${description} completed successfully`)
        resolve()
      } else {
        console.error(`${description} failed with code ${code}`)
        reject(new Error(`${description} failed with code ${code}`))
      }
    })

    rollupProcess.on('error', (error) => {
      clearTimeout(timeout)
      console.error(`Error starting ${description}:`, error)
      reject(error)
    })
  })
}

// Smart cache: inputs and ignore for hash
const nodeInputs = [
  'www/nodejs/main.mjs', 'www/nodejs/electron.mjs', 'www/nodejs/preload.mjs',
  'www/nodejs/modules/**/*.js', 'www/nodejs/modules/**/*.mjs',
  'package.json', 'rollup.config.node.mjs', 'babel.config.json', 'babel.node-output.json',
  'capacitor.config.json', 'android/app/build.gradle'
]
const rendererInputs = [
  'www/nodejs/renderer/src/**/*.js', 'www/nodejs/renderer/src/**/*.svelte',
  'www/nodejs/modules/**/*.js',
  'package.json', 'rollup.config.renderer.mjs', 'babel.renderer-output.json', 'babel.renderer-polyfills.json', 'babel.config.json',
  'capacitor.config.json'
]
const sharedIgnore = ['node_modules/**', 'www/nodejs/dist/**', 'www/nodejs/renderer/dist/**', '**/*.map', '.git/**', 'temp/**', 'releases/**', 'android/app/src/main/assets/**']

const fileStore = new FileStore({ cacheDir: '.rollup-smart-cache', lockTimeout: 300000, includeNode: true, includePlatform: true })

console.log('🔍 Smart cache: checking if rebuild is needed...')

try {
  // Node bundles
  const hashNode = await computeHash({ inputs: nodeInputs, ignore: sharedIgnore, env: ['NODE_ENV'], platform: true, node: true, cwd: __dirname })
  const entryNode = await fileStore.get(hashNode)
  if (entryNode) {
    console.log('✅ Node cache hit, restoring from cache...')
    restoreFromCache(entryNode, __dirname)
  } else {
    console.log('🔄 Node cache miss, running Rollup...')
    await runRollupAsync('rollup.config.node.mjs', 'Node.js bundles')
    const outputsNode = readNodeOutputs()
    if (outputsNode.size > 0) {
      await fileStore.set(hashNode, outputsNode, { hash: hashNode, timestamp: Date.now(), nodeVersion: process.version, platform: process.platform, outputs: [] })
    }
  }

  // Renderer bundles
  const hashRenderer = await computeHash({ inputs: rendererInputs, ignore: sharedIgnore, env: ['NODE_ENV'], platform: true, node: true, cwd: __dirname })
  const entryRenderer = await fileStore.get(hashRenderer)
  if (entryRenderer) {
    console.log('✅ Renderer cache hit, restoring from cache...')
    restoreFromCache(entryRenderer, __dirname)
  } else {
    console.log('🔄 Renderer cache miss, running Rollup...')
    await runRollupAsync('rollup.config.renderer.mjs', 'Renderer/Capacitor bundles')
    const outputsRenderer = readRendererOutputs()
    if (outputsRenderer.size > 0) {
      await fileStore.set(hashRenderer, outputsRenderer, { hash: hashRenderer, timestamp: Date.now(), nodeVersion: process.version, platform: process.platform, outputs: [] })
    }
  }

  console.log('All Rollup builds completed successfully')
} catch (error) {
  console.error('Rollup build failed:', error)
  process.exit(1)
}

// Remove .portable directory if it exists
const portableDir = path.join(__dirname, 'www', 'nodejs', '.portable')
if (fs.existsSync(portableDir)) fs.rmSync(portableDir, { recursive: true, force: true })

// Update versionName in android/app/build.gradle
const gradlePath = path.join(__dirname, 'android', 'app', 'build.gradle')
let buildGradle = fs.readFileSync(gradlePath, 'utf-8')
buildGradle = buildGradle.replace(/versionName\s+'.*'/, `versionName '${packageJson.version}'`)
fs.writeFileSync(gradlePath, buildGradle)

// Update version in www/nodejs/package.json
const nodePackagePath = path.join(__dirname, 'www', 'nodejs', 'package.json')
const nodePackageJson = JSON.parse(fs.readFileSync(nodePackagePath, 'utf-8'))
nodePackageJson.version = packageJson.version
fs.writeFileSync(nodePackagePath, JSON.stringify(nodePackageJson, null, 2))

// Sync with Capacitor
runCommand('npx cap sync', 'Capacitor sync')
removeUnusedFiles()
//removeElectronForAndroid()

console.log(`Finished: ${new Date().toLocaleString()}`)
