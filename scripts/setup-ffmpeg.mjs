#!/usr/bin/env node

// setup-ffmpeg.mjs - Setup FFmpeg for Flathub builds
// Based on build-electron.mjs FFmpeg logic

import { createWriteStream, existsSync, mkdirSync, copyFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..'); // Go up one level from scripts/

console.log('🎵 Setting up FFmpeg for Flathub...');

// Only handle linux-64 for Flathub
const currentPlatform = 'linux-64';
const binaryName = 'ffmpeg';
const ffmpegDir = join(rootDir, 'build', 'ffmpeg');
const platformFolder = join(ffmpegDir, currentPlatform);
const ffmpegSourcePath = join(platformFolder, binaryName);

// Ensure directories exist
if (!existsSync(ffmpegDir)) {
  mkdirSync(ffmpegDir, { recursive: true });
}

if (!existsSync(platformFolder)) {
  mkdirSync(platformFolder, { recursive: true });
}

async function setupFFmpeg() {
  try {
    // Check if FFmpeg already exists and has adequate size (> 10MB)
    const MIN_SIZE = 10 * 1024 * 1024; // 10MB
    let needsDownload = true;

    if (existsSync(ffmpegSourcePath)) {
      try {
        const fs = await import('fs');
        const stats = await fs.promises.stat(ffmpegSourcePath);
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
      console.log(`  ⬇️ Downloading FFmpeg for ${currentPlatform}...`);

      // Get FFmpeg download URL
      const binaryUrl = await getFFBinaryUrl(currentPlatform);
      if (!binaryUrl) {
        throw new Error(`Could not find FFmpeg URL for ${currentPlatform}`);
      }

      // Download the ZIP file
      const zipPath = ffmpegSourcePath + '.zip';
      await downloadFile(binaryUrl, zipPath);

      // Verify it's a valid ZIP
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

      // Extract using unzip (works on Linux)
      const { execSync } = await import('child_process');
      execSync(`unzip -o "${zipPath}" -d "${platformFolder}"`, { stdio: 'pipe' });

      // Remove the ZIP file
      const { rmSync } = await import('fs');
      rmSync(zipPath, { force: true });

      console.log(`  ✅ FFmpeg downloaded and extracted to ${platformFolder}`);
    }

    // Copy FFmpeg to the correct location for Flathub
    const targetDir = join(rootDir, 'dist', 'linux-unpacked', 'resources');
    const targetPath = join(targetDir, 'ffmpeg');

    // Ensure target directory exists
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    // Copy the binary
    copyFileSync(ffmpegSourcePath, targetPath);
    console.log(`  ✅ FFmpeg copied: ${ffmpegSourcePath} → ${targetPath}`);

  } catch (error) {
    console.error('  ❌ Failed to setup FFmpeg:', error.message);
    process.exit(1);
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

async function getFFBinaryUrl(variant) {
  try {
    const versionData = await getFFBinariesVersions();
    const latestVersion = Object.keys(versionData.versions).sort().reverse()[0];
    console.log(`  📋 Latest ffmpeg version: ${latestVersion}`);

    const versionUrl = versionData.versions[latestVersion];
    const versionInfo = await new Promise((resolve, reject) => {
      https.get(versionUrl, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse version info: ${e.message}`));
          }
        });
      }).on('error', reject);
    });

    const binaryUrl = versionInfo.bin && versionInfo.bin[variant] ? versionInfo.bin[variant].ffmpeg : null;
    return binaryUrl;
  } catch (error) {
    console.error('  ❌ Failed to get FFmpeg URL:', error.message);
    return null;
  }
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

// Run the setup
setupFFmpeg().then(() => {
  console.log('✅ FFmpeg setup completed!');
}).catch((error) => {
  console.error('❌ FFmpeg setup failed:', error);
  process.exit(1);
});
