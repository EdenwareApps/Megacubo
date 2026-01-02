#!/usr/bin/env node
import { createWriteStream, readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Detect platform early
const targetPlatform = process.argv[2] || 'win';

console.log('🚀 Starting optimized build of Megacubo (NO ASAR)...');

// 0. Prepare FFmpeg binaries early
console.log('📥 Preparing FFmpeg binaries...');
if (targetPlatform === 'linux') {
  // Use dedicated setup-ffmpeg.mjs for Linux (also handles copying)
  console.log('  📋 Using setup-ffmpeg.mjs for Linux build');
} else {
  // Use traditional prepareFFmpegBinaries for other platforms
  await prepareFFmpegBinaries();
}

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
  'worker.js', 'premium.js'
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

// Copy node_modules and windows.vbs to dist (only if premium exists)
console.log('📦 Copying node_modules and windows.vbs to dist/...');

// Check if premium.js exists in source before copying node_modules
const sourcePremiumPath = join(rootDir, 'www', 'nodejs', 'dist', 'premium.js');
const hasPremium = existsSync(sourcePremiumPath);

if (hasPremium) {
  try {
    execSync(`cp -r "${join(rootDir, 'www', 'nodejs', 'dist', 'node_modules')}" "${join(rootDir, 'temp', 'clean-app', 'dist')}"`, { stdio: 'pipe' });
    console.log(`  ✓ dist/node_modules`);
  } catch (e) {
    console.warn(`  ⚠ node_modules not found`);
  }
} else {
  console.log(`  ⚠ Skipping node_modules (no premium features)`);
}

// Copy specific required dependencies (bytenode, koffi only for Windows)
console.log('📦 Copying specific dependencies...');
const requiredDeps = ['bytenode'];

if (targetPlatform === 'win') {
  requiredDeps.push('koffi');
}

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
  icon: '../www/icon.png',
  dependencies: {}
};

// Add electron arguments for Linux to fix sandbox issues
if (targetPlatform === 'linux') {
  appPackageJson.scripts = {
    start: 'electron --no-sandbox --disable-dev-shm-usage --disable-gpu-sandbox .'
  };
}

writeFileSync(join(rootDir, 'temp', 'clean-app', 'package.json'), JSON.stringify(appPackageJson, null, 2));

// 5. Run build WITHOUT ASAR
console.log(`🔨 Running build for ${targetPlatform} (creating unpacked folder)...`);

// Copy windows.vbs only for Windows builds
if (targetPlatform === 'win') {
  try {
    copyFileSync(join(rootDir, 'www', 'nodejs', 'dist', 'windows.vbs'), join(rootDir, 'temp', 'clean-app', 'dist', 'windows.vbs'));
    console.log(`  ✓ dist/windows.vbs`);
  } catch (e) {
    console.warn(`  ⚠ windows.vbs not found`);
  }
} else {
  console.log(`  ⚠ Skipping windows.vbs (${targetPlatform} build)`);
}

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

// 7. FFmpeg binaries already prepared at startup

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
  if (existsSync(sourceBytenode)) {
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

// Function to download and prepare ffmpeg binaries
async function prepareFFmpegBinaries() {

  const ffmpegDir = join(rootDir, 'build', 'ffmpeg');
  const platforms = [
    { name: 'windows-64', ext: '.exe' },
    { name: 'linux-64', ext: '' },
    { name: 'macos-64', ext: '' }
  ];

  // Create directory if it doesn't exist
  if (!existsSync(ffmpegDir)) {
    mkdirSync(ffmpegDir, { recursive: true });
  }

  try {
    // Get version information from ffbinaries
    const versionData = await getFFBinariesVersions();
    const latestVersion = Object.keys(versionData.versions).sort().reverse()[0];

    console.log(`  📋 Latest ffmpeg version: ${latestVersion}`);

    // Download only for current platform
    const currentPlatform = process.platform === 'win32' ? 'windows-64' :
                           process.platform === 'darwin' ? 'macos-64' : 'linux-64';
    const binaryName = 'ffmpeg' + (currentPlatform === 'windows-64' ? '.exe' : '');

    const versionUrl = versionData.versions[latestVersion];
    const binaryUrl = await getFFBinaryUrl(versionUrl, currentPlatform);

    if (binaryUrl) {
      const platformFolder = join(ffmpegDir, currentPlatform);
      const filePath = join(platformFolder, binaryName);

      // Create platform subdirectory
      if (!existsSync(platformFolder)) {
        mkdirSync(platformFolder, { recursive: true });
      }

      // Check if it already exists and has adequate size (> 10MB)
      const MIN_SIZE = 10 * 1024 * 1024; // 10MB
      let needsDownload = true;

      if (existsSync(filePath)) {
        try {
          const stats = await import('fs').then(fs => fs.promises.stat(filePath));
          if (stats.size > MIN_SIZE) {
            console.log(`  ✅ FFmpeg already available (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
            needsDownload = false;
          } else {
            console.log(`  ⚠️ FFmpeg file too small, re-downloading...`);
          }
        } catch (statError) {
          console.log(`  ⚠️ Could not check FFmpeg size, re-downloading...`);
        }
      }

      if (needsDownload) {
        console.log(`  ⬇️ Downloading FFmpeg...`);

        // FFbinaries provides ZIP files, download and extract
        const zipPath = filePath + '.zip';
        await downloadFile(binaryUrl, zipPath);

        // Extract the binary from ZIP
        // Verify the downloaded file is actually a ZIP
        try {
          const fs = await import('fs');
          const buffer = Buffer.alloc(4);
          const fd = await fs.promises.open(zipPath, 'r');
          await fd.read(buffer, 0, 4, 0);
          await fd.close();

          const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;
          if (!isZip) {
            throw new Error('Downloaded file is not a valid ZIP archive');
          }
        } catch (verifyError) {
          console.error(`  ❌ File verification failed: ${verifyError.message}`);
          throw verifyError;
        }

        // Use platform-specific extraction method
        if (process.platform === 'win32') {
          // Windows: Use PowerShell Expand-Archive
          execSync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${platformFolder}' -Force"`, { stdio: 'pipe' });
        } else {
          // Linux/macOS: Use unzip
          execSync(`unzip -o "${zipPath}" -d "${platformFolder}"`, { stdio: 'pipe' });
        }

        // Remove the ZIP file
        rmSync(zipPath, { force: true });

        console.log(`  ✅ FFmpeg downloaded and extracted`);
      }
    }

    console.log('  ✅ FFmpeg binary prepared');
  } catch (error) {
    console.warn('  ⚠️ Failed to prepare ffmpeg binaries:', error.message);
    console.warn('  📝 FFmpeg will be downloaded at runtime if needed');
  }
}

function getFFBinariesVersions() {
  return new Promise((resolve, reject) => {
    const makeRequest = (url) => {
      https.get(url, (res) => {
        // Handle redirects
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location;
          makeRequest(redirectUrl.startsWith('http') ? redirectUrl : `https://ffbinaries.com${redirectUrl}`);
          return;
        }

        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${data.substring(0, 100)}...`));
          }
        });
      }).on('error', reject);
    };

    makeRequest('https://ffbinaries.com/api/v1/versions');
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
          const binaryUrl = versionInfo.bin && versionInfo.bin[variant] ? versionInfo.bin[variant].ffmpeg : null;
          resolve(binaryUrl);
        } catch (e) {
          reject(new Error(`Failed to parse version info: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const makeRequest = (requestUrl, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      const file = createWriteStream(destPath);
      const request = https.get(requestUrl, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          file.close();
          rmSync(destPath, { force: true });
          const redirectUrl = response.headers.location;
          makeRequest(redirectUrl.startsWith('http') ? redirectUrl : `https://github.com${redirectUrl}`, redirectCount + 1);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          rmSync(destPath, { force: true });
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      });

      request.on('error', (err) => {
        file.close();
        rmSync(destPath, { force: true });
        reject(err);
      });

      file.on('error', (err) => {
        rmSync(destPath, { force: true });
        reject(err);
      });
    };

    makeRequest(url);
  });
}

// 8. Add cast_channel.proto file (only if premium.js exists)
console.log('🔧 Adding cast_channel.proto file...');
try {
  // Only copy cast_channel.proto if premium.js exists in source
  const sourcePremiumPath = join(rootDir, 'www', 'nodejs', 'dist', 'premium.js');
  if (existsSync(sourcePremiumPath)) {
    // Ensure destination directory exists
    const destDir = join(appDir, 'dist');
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    // Copy from build/ directory (source of truth)
    copyFileSync(join(rootDir, 'build', 'cast_channel.proto'), join(destDir, 'cast_channel.proto'));
    console.log('  ✓ cast_channel.proto copied');
  } else {
    console.log('  ⚠ Skipping cast_channel.proto (premium.js not found)');
  }
} catch (e) {
  console.error('  ❌ Failed to copy cast_channel.proto:', e.message);
}

// 9. Copy appropriate ffmpeg binary to resources folder
console.log('🎵 Copying ffmpeg binary for current platform...');

// Use targetPlatform instead of process.platform for build target
if (targetPlatform === 'linux') {
  // For Linux, use the dedicated setup-ffmpeg.mjs script
  console.log('  📋 Running setup-ffmpeg.mjs for Linux...');
  try {
    execSync('node scripts/setup-ffmpeg.mjs', { stdio: 'inherit', cwd: rootDir });
    console.log('  ✅ FFmpeg setup completed via setup-ffmpeg.mjs');
  } catch (e) {
    console.warn('  ⚠️ Failed to run setup-ffmpeg.mjs:', e.message);
  }
  } else {
  // For Windows/Mac, use traditional copying logic
  let platformDir, binaryName, targetName;

  switch (targetPlatform) {
    case 'win32':
      platformDir = 'windows-64';
      binaryName = 'ffmpeg.exe';
      targetName = 'ffmpeg.exe';
      break;
    case 'darwin':
      platformDir = 'macos-64';
      binaryName = 'ffmpeg';
      targetName = 'ffmpeg';
      break;
    default:
      console.warn('  ⚠️ Unknown platform, skipping ffmpeg copy');
      break; // Skip FFmpeg copying for unknown platforms
  }

  // Only copy if we have valid platform info
  if (platformDir && binaryName && targetName) {
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
  }
}

// 11. Adjust package.json (remove type: module)
console.log('📝 Adjusting package.json...');
const appPackagePath = join(appDir, 'package.json');
const appPackage = JSON.parse(readFileSync(appPackagePath, 'utf8'));
delete appPackage.type; // Remove type: "module"
writeFileSync(appPackagePath, JSON.stringify(appPackage, null, 2));

// 11.5. Apply Linux sandbox fix before creating installer
if (targetPlatform === 'linux') {
  console.log('🛠️ Applying Linux AppImage sandbox fix...');

  // The unpacked app directory (where electron executable is located)
  const unpackedDir = join(rootDir, 'dist', 'linux-unpacked');
  const electronBinPath = join(unpackedDir, 'megacubo');
  const wrapperPath = join(unpackedDir, 'megacubo-original');

  console.log(`📁 Unpacked directory: ${unpackedDir}`);
  console.log(`🔍 Checking for executable: ${electronBinPath}`);
  console.log(`📂 File exists: ${existsSync(electronBinPath)}`);

  try {
    // Backup original executable
    if (existsSync(electronBinPath)) {
      console.log('💾 Backing up original executable...');
      copyFileSync(electronBinPath, wrapperPath);
      console.log('✅ Backup created successfully');

      // Create wrapper script
      const wrapperScript = `#!/bin/bash
# AppImage sandbox fix wrapper
export ELECTRON_DISABLE_SANDBOX=1
export ELECTRON_NO_SANDBOX=1
export DISABLE_SANDBOX=1

# Execute original binary with sandbox disabled
exec "${wrapperPath}" --no-sandbox --disable-dev-shm-usage --disable-gpu-sandbox "$@"
`;

      console.log('📝 Creating wrapper script...');
      writeFileSync(electronBinPath, wrapperScript, { mode: 0o755 });
      console.log('✅ Wrapper script created');

      // Verify the wrapper was created correctly
      const createdContent = readFileSync(electronBinPath, 'utf8');
      console.log('🔍 Verifying wrapper content...');
      console.log(`📄 Wrapper starts with: ${createdContent.substring(0, 50)}...`);

      console.log('  ✅ Linux sandbox fix applied successfully');
      console.log('  📝 Original binary backed up as megacubo-original');
    } else {
      console.warn('  ⚠️ megacubo executable not found for sandbox fix');
      console.warn(`   Expected at: ${electronBinPath}`);

      // List files in unpacked directory for debugging
      try {
        const files = readdirSync(unpackedDir);
        console.log('   📂 Files in unpacked directory:');
        files.forEach(file => console.log(`      - ${file}`));
      } catch (listError) {
        console.warn('   ❌ Could not list unpacked directory files:', listError.message);
      }
    }
  } catch (error) {
    console.error('  ❌ Failed to apply Linux sandbox fix:', error.message);
    console.error('  📋 Error details:', error);
  }
}

// 12. Create final installer based on platform
console.log(`📦 Creating installer for ${targetPlatform}...`);
let installerCommand;

switch (targetPlatform) {
  case 'win':
    installerCommand = `npx electron-builder --config electron-builder.config.mjs --win msi --publish=never --prepackaged "${unpackedDir}"`;
    break;
  case 'linux':
    // Gerar todos os formatos Linux: AppImage, Snap e Flatpak
    installerCommand = `npx electron-builder --config electron-builder.config.mjs --linux AppImage snap flatpak --publish=never --prepackaged "${unpackedDir}"`;
    break;
  case 'mac':
    installerCommand = `npx electron-builder --config electron-builder.config.mjs --mac dmg --publish=never --prepackaged "${unpackedDir}"`;
    break;
  default:
    installerCommand = `npx electron-builder --config electron-builder.config.mjs --win msi --linux AppImage --mac dmg --publish=never --prepackaged "${unpackedDir}"`;
}

try {
  execSync(installerCommand, { stdio: 'inherit', cwd: rootDir });
  console.log('✅ Installer created successfully!');
} catch (error) {
  console.error('❌ Error creating the installer:', error.message);
  console.log('📁 But premium protection was successfully applied to the unpacked folder!');
  console.log(`📂 Folder ready: ${unpackedDir}`);
  process.exit(1); // Exit with error code
}

// 11. Clean temp folder
console.log('🧹 Cleaning temporary files...');
rmSync(join(rootDir, 'temp'), { recursive: true, force: true });

console.log('✅ Optimized build finished (NO ASAR)!');
console.log('📊 Check installer size in dist/');
console.log('📁 Final structure:');
console.log(`  - Compiled files: ${unpackedDir}/resources/app/dist/`);
console.log(`  - Languages: ${unpackedDir}/resources/app/lang/`);
console.log(`  - Renderer: ${unpackedDir}/resources/app/renderer/`);

process.nextTick(() => process.exit(0))