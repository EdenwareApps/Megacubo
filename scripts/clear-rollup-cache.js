import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')

console.log('Clearing Rollup cache...')

// Clear Rollup cache directory
const cacheDir = path.join(projectRoot, 'node_modules', '.cache', 'rollup')
if (fs.existsSync(cacheDir)) {
  fs.rmSync(cacheDir, { recursive: true, force: true })
  console.log('✓ Rollup cache cleared')
}

// Clear any temporary build files
const tempFiles = [
  'rollup.config.renderer.mjs',
  'rollup.config.main.mjs',
  'rollup.config.electron.mjs',
  'rollup.config.workers.mjs',
  'rollup.config.premium.mjs'
]

tempFiles.forEach(file => {
  const filePath = path.join(projectRoot, file)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
    console.log(`✓ Removed ${file}`)
  }
})

// Clear only build artifacts, preserve important files
const clearDistArtifacts = (distPath) => {
  if (!fs.existsSync(distPath)) return
  
  const files = fs.readdirSync(distPath)
  files.forEach(file => {
    const filePath = path.join(distPath, file)
    const stat = fs.statSync(filePath)
    
    if (stat.isDirectory()) {
      // Preserve subdirectories
      console.log(`✓ Preserved directory: ${file}`)
    } else if (file.endsWith('.js') || file.endsWith('.js.map') || file.endsWith('.mjs')) {
      // Remove only JS build artifacts
      fs.unlinkSync(filePath)
      console.log(`✓ Removed build artifact: ${file}`)
    } else {
      // Preserve other files (like .proto, .dat, etc.)
      console.log(`✓ Preserved file: ${file}`)
    }
  })
}

// Clear build artifacts from dist directories
const distDirs = [
  'www/nodejs/dist',
  'www/nodejs/renderer/dist',
  'android/app/src/main/assets/public/nodejs/dist',
  'android/app/src/main/assets/public/nodejs/renderer/dist'
]

distDirs.forEach(dir => {
  const dirPath = path.join(projectRoot, dir)
  clearDistArtifacts(dirPath)
})

console.log('Cache clearing completed')