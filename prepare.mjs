import { execSync, spawn } from 'node:child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'
import packageJson from './package.json' with { type: 'json' }

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

// Smart cache function - checks if rebuild is needed
function shouldSkipBuild() {
  const outputDirs = [
    'www/nodejs/dist',
    'www/nodejs/renderer/dist'
  ];

  // Check if all output directories exist
  for (const dir of outputDirs) {
    if (!fs.existsSync(dir)) {
      console.log(`📂 Output directory ${dir} missing, rebuild needed`);
      return false;
    }
  }

  // Files that invalidate cache (always rebuild if changed)
  const cacheBusters = [
    'package.json',                    // npm dependencies
    'www/nodejs/main.mjs',             // main entry point
    'www/nodejs/electron.mjs',         // electron entry point
    'rollup.config.node.mjs',          // node rollup config
    'rollup.config.renderer.mjs',      // renderer rollup config
    'babel.node-output.json',          // babel config
    'babel.renderer-output.json'       // babel config
  ];

  // Get newest output file time
  const newestOutput = getNewestFileTime(outputDirs);

  // Check cache busters against outputs
  for (const buster of cacheBusters) {
    if (fs.existsSync(buster)) {
      const busterTime = fs.statSync(buster).mtime;
      if (busterTime > newestOutput) {
        console.log(`📋 ${buster} changed (${busterTime.toISOString()}), rebuild needed`);
        return false;
      }
    }
  }

  // Check source directories for changes
  const sourceDirs = ['www/nodejs/modules', 'www/nodejs/renderer/src'];
  for (const sourceDir of sourceDirs) {
    if (fs.existsSync(sourceDir)) {
      const newestSource = getNewestFileTime([sourceDir]);
      if (newestSource > newestOutput) {
        console.log(`📋 ${sourceDir} has changes (${new Date(newestSource).toISOString()} > ${new Date(newestOutput).toISOString()}), rebuild needed`);
        return false;
      }
    }
  }

  return true; // Can skip build
}

// Helper to get newest file modification time in directories
function getNewestFileTime(dirs) {
  let newest = 0;

  function walkDir(dir) {
    if (!fs.existsSync(dir)) return;

    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);

      // Skip node_modules and other unwanted dirs
      if (item === 'node_modules' || item === '.git' || item.startsWith('.')) {
        continue;
      }

      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walkDir(fullPath);
      } else if (stat.isFile()) {
        if (stat.mtime > newest) {
          newest = stat.mtime;
        }
      }
    }
  }

  for (const dir of dirs) {
    walkDir(dir);
  }

  return newest;
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
    
    const rollupProcess = spawn('npx', ['rollup', '-c', configFile], {
      stdio: 'inherit',
      shell: true,
      env: { 
        ...process.env, 
        NODE_OPTIONS: nodeOptions 
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

// Check if rebuild is needed
console.log('🔍 Checking if rebuild is needed...')

if (shouldSkipBuild()) {
  console.log('✅ Bundles are up-to-date, skipping Rollup builds!')
} else {
  console.log('🔄 Rebuild needed, starting Rollup builds...')

  // Run rollup configs sequentially
  try {
    await runRollupAsync('rollup.config.node.mjs', 'Node.js bundles')
    await runRollupAsync('rollup.config.renderer.mjs', 'Renderer/Capacitor bundles')
    console.log('All Rollup builds completed successfully')
  } catch (error) {
    console.error('Rollup build failed:', error)
    process.exit(1)
  }
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
