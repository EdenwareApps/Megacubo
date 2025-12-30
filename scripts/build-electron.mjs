#!/usr/bin/env node
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

console.log('🚀 Starting optimized build of Megacubo (NO ASAR)...');

// 1. Prepare clean-app folder
console.log('🧹 Preparing clean-app folder...');
rmSync(join(rootDir, 'temp'), { recursive: true, force: true });
mkdirSync(join(rootDir, 'temp', 'clean-app'), { recursive: true });
mkdirSync(join(rootDir, 'temp', 'clean-app', 'dist'), { recursive: true });

// 2. Copy only essential files to dist folder
console.log('📋 Copying essential files to dist/...');
const essentialFiles = [
  'main.js', 'electron.js', 'preload.js',
  'updater-worker.js', 'EPGManager.js', 'mpegts-processor-worker.js',
  'worker.js', 'premium.js', 'cast_channel.proto'
];

essentialFiles.forEach(file => {
  const src = join(rootDir, 'www', 'nodejs', 'dist', file);
  const dest = join(rootDir, 'temp', 'clean-app', 'dist', file);
  try {
    copyFileSync(src, dest);
    console.log(`  ✓ dist/${file}`);
  } catch (e) {
    console.warn(`  ⚠ ${file} not found`);
  }
});

// Copy essential data folders to dist
console.log('📊 Copying essential data folders to dist/...');
const dataDirs = ['dayjs-locale', 'defaults'];
dataDirs.forEach(dir => {
  const src = join(rootDir, 'www', 'nodejs', 'dist', dir);
  const dest = join(rootDir, 'temp', 'clean-app', 'dist', dir);
  try {
    execSync(`cp -r "${src}" "${dest}"`, { stdio: 'pipe' });
    console.log(`  ✓ dist/${dir}`);
  } catch (e) {
    console.warn(`  ⚠ ${dir} not found`);
  }
});

// Copy node_modules and windows.vbs to dist
console.log('📦 Copying node_modules and windows.vbs to dist/...');
try {
  execSync(`cp -r "${join(rootDir, 'www', 'nodejs', 'dist', 'node_modules')}" "${join(rootDir, 'temp', 'clean-app', 'dist')}"`, { stdio: 'pipe' });
  console.log(`  ✓ dist/node_modules`);
} catch (e) {
  console.warn(`  ⚠ node_modules not found`);
}

try {
  copyFileSync(join(rootDir, 'www', 'nodejs', 'dist', 'windows.vbs'), join(rootDir, 'temp', 'clean-app', 'dist', 'windows.vbs'));
  console.log(`  ✓ dist/windows.vbs`);
} catch (e) {
  console.warn(`  ⚠ windows.vbs not found`);
}

// Copy specific required dependencies (bytenode, koffi)
console.log('📦 Copying specific dependencies...');
const requiredDeps = ['bytenode', 'koffi'];

requiredDeps.forEach(dep => {
  try {
    execSync(`cp -r "${join(rootDir, 'node_modules', dep)}" "${join(rootDir, 'temp', 'clean-app', 'dist', 'node_modules')}"`, { stdio: 'pipe' });
    console.log(`  ✓ dist/node_modules/${dep}`);
  } catch (e) {
    console.warn(`  ⚠ ${dep} not found in root node_modules`);
  }
});

// 3. Copy lang and renderer folders
console.log('🌍 Copying lang and renderer folders...');
const sourceDirs = ['lang', 'renderer'];
sourceDirs.forEach(dir => {
  const src = join(rootDir, 'www', 'nodejs', dir);
  const dest = join(rootDir, 'temp', 'clean-app', dir);
  try {
    execSync(`cp -r "${src}" "${dest}"`, { stdio: 'pipe' });
    console.log(`  ✓ ${dir}/`);
  } catch (e) {
    console.warn(`  ⚠ ${dir} not found`);
  }
});

// 4. Create app package.json
console.log('📄 Creating package.json for the app...');
const appPackageJson = {
  name: 'megacubo-app',
  version: '17.6.2',
  main: 'dist/main.js',
  dependencies: {}
};
writeFileSync(join(rootDir, 'temp', 'clean-app', 'package.json'), JSON.stringify(appPackageJson, null, 2));

// 5. Detect platform and run build WITHOUT ASAR
const targetPlatform = process.argv[2] || 'win'; // win, linux, mac, or all
console.log(`🔨 Running build for ${targetPlatform} (creating unpacked folder)...`);

let buildCommand;
switch (targetPlatform) {
  case 'win':
    buildCommand = 'npx electron-builder --win --dir --publish=never';
    break;
  case 'linux':
    buildCommand = 'npx electron-builder --linux --dir --publish=never';
    break;
  case 'mac':
    buildCommand = 'npx electron-builder --mac --dir --publish=never';
    break;
  default:
    buildCommand = 'npx electron-builder --win --linux --mac --dir --publish=never';
}

try {
  execSync(buildCommand, { stdio: 'inherit', cwd: rootDir });
} catch (error) {
  console.error('❌ Error during build:', error.message);
  process.exit(1);
}

// 6. Detect and process folder structure based on platform
console.log('📦 Converting to structure without ASAR...');

// Function to find the unpacked folder based on platform
function findUnpackedDir() {
  const distDir = join(rootDir, 'dist');

  // Look for unpacked folders in various patterns
  const possibleDirs = [
    join(distDir, 'win-unpacked'),
    join(distDir, 'linux-unpacked'),
    join(distDir, 'mac'),
    join(distDir, 'mac-arm64')
  ];

  for (const dir of possibleDirs) {
    if (existsSync(dir)) {
      const resourcesDir = join(dir, 'resources');
      if (existsSync(resourcesDir)) {
        return { unpackedDir: dir, resourcesDir };
      }
    }
  }

  // Fallback: search recursively
  const fs = require('fs');
  function findRecursively(dir) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (item.includes('unpacked') || item.includes('mac')) {
          const resourcesDir = join(fullPath, 'resources');
          if (existsSync(resourcesDir)) {
            return { unpackedDir: fullPath, resourcesDir };
          }
        }
        const result = findRecursively(fullPath);
        if (result) return result;
      }
    }
    return null;
  }

  return findRecursively(distDir);
}

const dirInfo = findUnpackedDir();
if (!dirInfo) {
  console.error('❌ ERROR: Could not find the unpacked folder!');
  process.exit(1);
}

const { unpackedDir, resourcesDir } = dirInfo;
const appDir = join(resourcesDir, 'app');
console.log(`  📁 Found folder: ${unpackedDir}`);

// Remove ASAR if exists
try {
  rmSync(join(resourcesDir, 'app.asar'), { recursive: true, force: true });
  rmSync(join(resourcesDir, 'app.asar.unpacked'), { recursive: true, force: true });
} catch (e) {
  // Ignore if not exists
}

// Create app folder and copy files
mkdirSync(appDir, { recursive: true });
execSync(`cp -r "${join(rootDir, 'temp', 'clean-app')}"/* "${appDir}/"`, { stdio: 'inherit' });

// 7. Download and prepare ffmpeg binaries
console.log('📥 Downloading ffmpeg binaries...');
await prepareFFmpegBinaries();

// 8. Compile premium.js to bytecode before creating installer
console.log('🔒 Compiling premium.js to bytecode before creating installer...');

const appDistDir = join(appDir, 'dist');
const premiumJsPath = join(appDistDir, 'premium.js');
const premiumJscPath = join(appDistDir, 'premium.jsc');

// Check if bytenode is available
const bytenodePath = join(appDistDir, 'node_modules', 'bytenode');
if (!existsSync(bytenodePath)) {
  console.warn('  ⚠ Bytenode not found in app dist, copying...');
  const sourceBytenode = join(rootDir, 'node_modules', 'bytenode');
  if (fs.existsSync(sourceBytenode)) {
    execSync(`cp -r "${sourceBytenode}" "${bytenodePath}"`, { stdio: 'pipe' });
    console.log('  ✓ Bytenode copied to app');
  } else {
    console.error('  ❌ Bytenode not found in source!');
    process.exit(1);
  }
}

// Get Electron executable
let electronExecutable;
const platform = process.platform;
const rootDirResolved = join(__dirname, '..');

switch (platform) {
  case 'win32':
    electronExecutable = join(rootDirResolved, 'node_modules', 'electron', 'dist', 'electron.exe');
    break;
  case 'darwin':
    electronExecutable = join(rootDirResolved, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
    break;
  default: // linux
    electronExecutable = join(rootDirResolved, 'node_modules', 'electron', 'dist', 'electron');
}

// Create temp script for compilation
const tempScriptPath = join(appDir, 'temp_bytenode_compile.cjs');
const scriptContent = `
const path = require('path');
const bytenode = require(path.join(process.cwd(), 'dist', 'node_modules', 'bytenode'));
const premiumPath = path.join(process.cwd(), 'dist', 'premium.js');
const jscPath = path.join(process.cwd(), 'dist', 'premium.jsc');

console.log('Compiling premium.js to bytecode...');

try {
  const fs = require('fs');
  if (!fs.existsSync(premiumPath)) {
    throw new Error('premium.js not found at: ' + premiumPath);
  }

  bytenode.compileFile(premiumPath, jscPath);

  if (fs.existsSync(jscPath)) {
    fs.unlinkSync(premiumPath); // Remove original
    console.log('✅ Premium bytecode compilation successful');
    console.log('✅ premium.js removed, premium.jsc created');
  } else {
    throw new Error('premium.jsc was not created');
  }
} catch (error) {
  console.error('❌ Premium compilation failed:', error.message);
  process.exit(1);
}
`;

writeFileSync(tempScriptPath, scriptContent);

try {
  console.log('  🔨 Running bytenode compilation with Electron...');
  execSync(`"${electronExecutable}" "${tempScriptPath}"`, {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });
  console.log('  ✅ Premium protection applied successfully');
} catch (error) {
  console.error('  ❌ Failed to compile premium:', error.message);
  process.exit(1);
        } finally {
          // Clean up temp file
          try {
            rmSync(tempScriptPath, { force: true });
          } catch (e) {
            // Ignore cleanup errors
          }
        }

// Verify final state
if (existsSync(join(appDir, 'dist', 'premium.jsc'))) {
  console.log('  ✅ premium.jsc ready for distribution');
} else {
  console.error('  ❌ premium.jsc not found after compilation!');
  process.exit(1);
}

// Função para baixar e preparar binários ffmpeg
async function prepareFFmpegBinaries() {
  const { default: https } = await import('https');

  const ffmpegDir = join(rootDir, 'build', 'ffmpeg');
  const platforms = [
    { name: 'windows-64', ext: '.exe' },
    { name: 'linux-64', ext: '' },
    { name: 'macos-64', ext: '' }
  ];

  // Criar diretório se não existir
  if (!existsSync(ffmpegDir)) {
    mkdirSync(ffmpegDir, { recursive: true });
  }

  try {
    // Obter informações de versão do ffbinaries
    const versionData = await getFFBinariesVersions();
    const latestVersion = Object.keys(versionData.versions).sort().reverse()[0];

    console.log(`  📋 Latest ffmpeg version: ${latestVersion}`);

    for (const platform of platforms) {
      const binaryUrl = await getFFBinaryUrl(versionData.versions[latestVersion], platform.name);
      if (binaryUrl) {
        const platformDir = join(ffmpegDir, platform.name);
        const fileName = `ffmpeg${platform.ext}`;
        const filePath = join(platformDir, fileName);

        // Criar subdiretório da plataforma
        if (!existsSync(platformDir)) {
          mkdirSync(platformDir, { recursive: true });
        }

        // Verificar se já existe
        if (existsSync(filePath)) {
          console.log(`  ✅ ${platform.name} ffmpeg already exists`);
          continue;
        }

        console.log(`  ⬇️ Downloading ffmpeg for ${platform.name}...`);

        await downloadFile(binaryUrl, filePath);
        console.log(`  ✅ Downloaded ffmpeg for ${platform.name}`);
      }
    }

    console.log('  ✅ All ffmpeg binaries prepared');
  } catch (error) {
    console.warn('  ⚠️ Failed to prepare ffmpeg binaries:', error.message);
    console.warn('  📝 FFmpeg will be downloaded at runtime if needed');
  }
}

function getFFBinariesVersions() {
  return new Promise((resolve, reject) => {
    const url = 'https://ffbinaries.com/api/v1/versions';
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function getFFBinaryUrl(versionUrl, variant) {
  return new Promise((resolve, reject) => {
    https.get(versionUrl, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const versionInfo = JSON.parse(data);
          resolve(versionInfo.bin && versionInfo.bin[variant] ? versionInfo.bin[variant].ffmpeg : null);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const { createWriteStream } = require('fs');
    const file = createWriteStream(destPath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      rmSync(destPath, { force: true }); // Deletar arquivo incompleto
      reject(err);
    });
  });
}

// 8. Add cast_channel.proto file
console.log('🔧 Adding cast_channel.proto file...');
copyFileSync(join(rootDir, 'www', 'nodejs', 'dist', 'cast_channel.proto'), join(appDir, 'dist', 'cast_channel.proto'));

// 9. Copy appropriate ffmpeg binary to resources folder
console.log('🎵 Copying ffmpeg binary for current platform...');

// Detect current platform being built
const currentPlatform = process.platform; // 'win32', 'linux', 'darwin'
let platformDir, binaryName, targetName;

switch (currentPlatform) {
  case 'win32':
    platformDir = 'windows-64';
    binaryName = 'ffmpeg.exe';
    targetName = 'ffmpeg.exe';
    break;
  case 'linux':
    platformDir = 'linux-64';
    binaryName = 'ffmpeg';
    targetName = 'ffmpeg';
    break;
  case 'darwin':
    platformDir = 'macos-64';
    binaryName = 'ffmpeg';
    targetName = 'ffmpeg';
    break;
  default:
    console.warn('  ⚠️ Unknown platform, skipping ffmpeg copy');
    break;
}

const ffmpegSourcePath = join(rootDir, 'build', 'ffmpeg', platformDir, binaryName);
const ffmpegTargetPath = join(resourcesDir, targetName);

if (existsSync(ffmpegSourcePath)) {
  try {
    copyFileSync(ffmpegSourcePath, ffmpegTargetPath);
    console.log(`  ✅ FFmpeg binary copied: ${platformDir}/${binaryName} → resources/${targetName}`);
  } catch (e) {
    console.warn('  ⚠️ Failed to copy ffmpeg binary:', e.message);
  }
} else {
  console.log(`  ⚠️ FFmpeg binary not found: ${platformDir}/${binaryName}`);
}

// 11. Adjust package.json (remove type: module)
console.log('📝 Adjusting package.json...');
const appPackagePath = join(appDir, 'package.json');
const appPackage = JSON.parse(readFileSync(appPackagePath, 'utf8'));
delete appPackage.type; // Remove type: "module"
writeFileSync(appPackagePath, JSON.stringify(appPackage, null, 2));

// 12. Create final installer based on platform
console.log(`📦 Creating installer for ${targetPlatform}...`);
let installerCommand;

switch (targetPlatform) {
  case 'win':
    installerCommand = `npx electron-builder --win msi --publish=never --prepackaged "${unpackedDir}"`;
    break;
  case 'linux':
    installerCommand = `npx electron-builder --linux AppImage --publish=never --prepackaged "${unpackedDir}"`;
    break;
  case 'mac':
    installerCommand = `npx electron-builder --mac dmg --publish=never --prepackaged "${unpackedDir}"`;
    break;
  default:
    installerCommand = `npx electron-builder --win msi --linux AppImage --mac dmg --publish=never --prepackaged "${unpackedDir}"`;
}

try {
  execSync(installerCommand, { stdio: 'inherit', cwd: rootDir });
  console.log('✅ Installer created successfully!');
} catch (error) {
  console.warn('⚠️ Error creating the installer:', error.message);
  console.log('📁 But premium protection was successfully applied to the unpacked folder!');
  console.log(`📂 Folder ready: ${unpackedDir}`);
}

// 11. Clean temp folder
console.log('🧹 Cleaning temporary files...');
rmSync(join(rootDir, 'temp'), { recursive: true, force: true });

console.log('✅ Optimized build finished (NO ASAR)!');
console.log('📊 Check installer size in dist/*.exe');
console.log('📁 Final structure:');
console.log('  - Compiled files: dist/win-unpacked/resources/app/dist/');
console.log('  - Languages: dist/win-unpacked/resources/app/lang/');
console.log('  - Renderer: dist/win-unpacked/resources/app/renderer/');
