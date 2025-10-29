import { execSync } from 'node:child_process'
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

// Run Rollup build
runCommand('npx rollup -c', 'Rollup')

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
