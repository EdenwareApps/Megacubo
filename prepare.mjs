import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Get the current directory in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Dynamically import the version from package.json
const { default: { version: appVersion } } = await import('file://' + path.join(__dirname, 'package.json'), { assert: { type: 'json' } })

// Exit if appVersion is empty or invalid
if (!appVersion || !/^[0-9]+(\.[0-9]+)*$/.test(appVersion)) {
  console.error(`Invalid or empty appVersion: ${appVersion}`)
  process.exit(1)
}

console.log(`App version: ${appVersion}`)

// Helper to run commands and handle errors
const runCommand = (command, description) => {
  try {
    execSync(command, { stdio: 'inherit' })
  } catch (error) {
    console.error(`${description} failed with code ${error.status}`)
    process.exit(error.status)
  }
}

// Run Rollup build
runCommand('npx rollup -c', 'Rollup')

// Remove .portable directory if it exists
const portableDir = path.join(__dirname, 'www', 'nodejs', '.portable')
if (fs.existsSync(portableDir)) fs.rmSync(portableDir, { recursive: true, force: true })

// Update versionName in android/app/build.gradle
const gradlePath = path.join(__dirname, 'android', 'app', 'build.gradle')
let buildGradle = fs.readFileSync(gradlePath, 'utf-8')
buildGradle = buildGradle.replace(/versionName\s+'.*'/, `versionName '${appVersion}'`)
fs.writeFileSync(gradlePath, buildGradle)

// Update version in www/nodejs/package.json
const nodePackagePath = path.join(__dirname, 'www', 'nodejs', 'package.json')
const nodePackageJson = JSON.parse(fs.readFileSync(nodePackagePath, 'utf-8'))
nodePackageJson.version = appVersion
fs.writeFileSync(nodePackagePath, JSON.stringify(nodePackageJson, null, 2))

// Sync with Capacitor
runCommand('npx cap sync', 'Capacitor sync')

console.log(`Finished: ${new Date().toLocaleString()}`)
