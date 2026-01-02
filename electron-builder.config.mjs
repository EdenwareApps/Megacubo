import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageJson = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
const { name, version, description, author } = packageJson;

export default {
  appId: 'tv.megacubo.app',
  productName: 'Megacubo',
  copyright: `Copyright © ${new Date().getFullYear()} ${author.name}`,
  npmRebuild: false,
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,
  // Settings to prevent automatic inclusion of dependencies

  files: [
    // Arquivos JavaScript compilados essenciais
    'www/nodejs/dist/main.js',
    'www/nodejs/dist/electron.js',
    'www/nodejs/dist/preload.js',
    'www/nodejs/dist/worker.js',
    'www/nodejs/dist/updater-worker.js',
    'www/nodejs/dist/EPGManager.js',
    'www/nodejs/dist/mpegts-processor-worker.js',
    'www/nodejs/dist/premium.js',

    // Arquivos Svelte compilados
    'www/nodejs/dist/App.js',
    'www/nodejs/dist/capacitor.js',

    // Dados essenciais
    'www/nodejs/dist/dayjs-locale/**',
    'www/nodejs/dist/defaults/**',

    // Arquivos fonte e configuração
    'www/nodejs/main.mjs',
    'www/nodejs/package.json',
    'www/nodejs/lang/**/*',
    'www/nodejs/modules/**/*',
    'www/nodejs/renderer/**/*',

    // Exclusões críticas
    '!www/nodejs/dist/electron.js.map',
    '!www/nodejs/dist/main.js.map',
    '!www/nodejs/dist/preload.js.map',
    '!www/nodejs/dist/*.worker.js.map',
    '!www/nodejs/modules/smart-recommendations/trias/**/*',

    // Exclusões AGRESSIVAS de espaço em disco
    '!android/**',  // Excluir diretório android completo
    '!**/android/**',  // Excluir QUALQUER pasta android em qualquer lugar
    '!releases/**',  // Excluir releases (APKs, builds antigos)
    '!premium_files/**',  // Excluir arquivos premium não necessários para build
    '!dist_optimized/**',  // Excluir builds otimizados antigos
    '!patches/**',  // Excluir patches
    '!assets/**',  // Excluir assets não utilizados no Electron
    '!build/**',  // Excluir pasta build (exceto o que precisamos)
    '!build/cast_channel.proto',  // MANTER apenas este arquivo necessário
    '!build/ffmpeg/**',  // MANTER FFmpeg

    // Exclusões de bibliotecas nativas
    '!**/*.so',  // Excluir bibliotecas nativas Linux (.so)
    '!**/*.dylib',  // Excluir bibliotecas macOS (.dylib)
    '!**/*.dll',  // Excluir bibliotecas Windows (.dll) - serão incluídas apenas as necessárias
    '!**/*.a',  // Excluir bibliotecas estáticas
    '!**/*.lib',  // Excluir bibliotecas Windows

    // Exclusões de desenvolvimento
    '!node_modules/**',  // Excluir QUALQUER node_modules da raiz
    '!**/build/**',  // Excluir pastas de build desnecessárias
    '!www/nodejs/dist/node_modules/**',  // Excluir TODAS as dependências node_modules
    '!**/*.map',  // Excluir source maps
    '!**/*.ts',  // Excluir arquivos TypeScript
    '!**/*.test.*',  // Excluir arquivos de teste
    '!docs/**',  // Excluir documentação
    '!*.md',  // Excluir arquivos markdown
    '!*.cmd',  // Excluir scripts de comando
    '!*.bat',  // Excluir arquivos batch
    '!*.log',  // Excluir arquivos de log
    '!*.txt',  // Excluir arquivos de texto não essenciais
    '!*.aar',  // Excluir arquivos Android .aar
    '!*.apk',  // Excluir arquivos Android .apk
    '!*.zip',  // Excluir arquivos ZIP
    '!*.exe',  // Excluir executáveis Windows (exceto os necessários)
    '!fmpeg-kit-16KB-6.0.aar',  // Excluir arquivo específico do FFmpeg Android
    '!fnr.exe',  // Excluir Find and Replace tool
  ],

  // Platform-specific settings

  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64', 'ia32']
      },
      {
        target: 'msi',
        arch: ['x64', 'ia32']
      }
    ],
    verifyUpdateCodeSignature: false
  },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    include: null,
    script: null
  },

  mac: {
    target: [
      {
        target: 'dmg',
        arch: ['x64', 'arm64']
      },
      {
        target: 'zip',
        arch: ['x64', 'arm64']
      }
    ],
    icon: 'www/nodejs/default_icon.icns',
    category: 'public.app-category.video',
    darkModeSupport: true,
    hardenedRuntime: false,
    gatekeeperAssess: false
  },

  // Simplified hook - since node_modules is already excluded, this hook has limited effect
  // but it can be useful for other file types
  onNodeModuleFile: (file) => {
    // As node_modules is excluded in the files configuration,
    // this hook has little effect, but we keep it for safety
      return 'exclude';
  },
  // Build hooks (optimized solution)
  beforeBuild: async (context) => {
    console.log('🔨 Starting Megacubo build...');
    console.log('📦 Platform:', context.platform.nodeName);
    console.log('🏗️ Architecture:', context.arch);
    console.log('📋 Build type:', context.targets.map(t => t.name).join(', '));
  },

  afterPack: async (context) => {
    console.error('🔥🔥🔥 AFTERPACK HOOK EXECUTED! 🔥🔥🔥');
    console.error('✅ Build finished - optimized files!');
    console.error('🔍 DEBUG: afterPack hook called with context:', {
      platform: context.platform?.nodeName,
      appOutDir: context.appOutDir,
      electronDistPath: context.electronDistPath
    });

    // Compile premium.js to bytecode using Electron (ensures compatibility)
    console.log('🔒 Compiling premium.js to bytecode using Electron runtime...');

    const appOutDir = context.appOutDir;
    const premiumJsPath = join(appOutDir, 'dist', 'premium.js');
    const premiumJscPath = join(appOutDir, 'dist', 'premium.jsc');

    // Get Electron executable path for current platform
    let electronExecutable;
    switch (context.platform.nodeName) {
      case 'win32':
        electronExecutable = join(context.electronDistPath, 'electron.exe');
        break;
      case 'darwin':
        electronExecutable = join(context.electronDistPath, 'Electron.app', 'Contents', 'MacOS', 'Electron');
        break;
      default: // linux
        electronExecutable = join(context.electronDistPath, 'electron');
    }

    console.log(`  📍 Electron executable: ${electronExecutable}`);
    console.log(`  📁 App directory: ${appOutDir}`);

    if (existsSync(premiumJsPath)) {
      try {
        // Use Electron to compile bytenode (ensures V8 compatibility)
        const compileCommand = `"${electronExecutable}" -e "
          const path = require('path');
          const bytenode = require(path.join(process.cwd(), 'dist', 'node_modules', 'bytenode'));
          const premiumPath = path.join(process.cwd(), 'dist', 'premium.js');
          const jscPath = path.join(process.cwd(), 'dist', 'premium.jsc');
          bytenode.compileFile(premiumPath, jscPath);
          console.log('✅ premium.jsc compiled successfully with Electron');
        "`;

        console.log('  🔨 Running bytenode compilation...');
        execSync(compileCommand, {
          cwd: appOutDir,
          stdio: 'inherit',
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
        });

        // Verify compilation succeeded
        if (existsSync(premiumJscPath)) {
          // Remove the original JavaScript file
          unlinkSync(premiumJsPath);
          console.log('  ✅ Premium bytecode protection applied successfully');
          console.log('  🗑️ Original premium.js removed from distribution');
        } else {
          throw new Error('premium.jsc was not created');
        }

      } catch (error) {
        console.error('  ❌ ERROR: Failed to compile premium.jsc with Electron:', error.message);
        console.error('  📝 This build will continue but premium code is not protected!');
        // Don't fail the build, just warn - premium still works without protection
      }
    } else {
      console.log('  ⚠️ premium.js not found - skipping bytecode compilation');
    }

    // Fix AppImage sandbox issues on Linux by creating a wrapper script
    if (context.platform.nodeName === 'linux') {
      console.log('  🛠️ Creating AppImage sandbox fix wrapper...');

      const appOutDir = context.appOutDir;
      const electronBinPath = join(appOutDir, 'megacubo'); // Default electron executable name

      // Create a wrapper script that launches electron with --no-sandbox
      const wrapperScript = `#!/bin/bash
# AppImage wrapper to fix sandbox issues on Linux VMs
export ELECTRON_DISABLE_SANDBOX=1
export ELECTRON_NO_SANDBOX=1
export DISABLE_SANDBOX=1

# Launch electron with sandbox disabled
exec "${electronBinPath}" --no-sandbox --disable-dev-shm-usage --disable-gpu-sandbox "$@"
`;

      const wrapperPath = join(appOutDir, 'megacubo-wrapper');
      writeFileSync(wrapperPath, wrapperScript, { mode: 0o755 }); // Make executable

      // Replace the original executable with the wrapper
      try {
        renameSync(electronBinPath, electronBinPath + '.original');
        renameSync(wrapperPath, electronBinPath);
        console.log('  ✅ AppImage sandbox fix applied successfully');
        console.log('  📝 Original electron binary backed up as megacubo.original');
      } catch (error) {
        console.error('  ❌ Failed to apply sandbox fix:', error.message);
      }
    }
  },

  afterAllArtifactBuild: async (buildResult) => {
    console.log('🎯 All artifacts built - fixing AppImage sandbox issues...');

    // buildResult is a BuildResult object, artifactPaths is the array
    const appImageArtifacts = buildResult.artifactPaths.filter(artifact =>
      artifact.endsWith('.AppImage')
    );

    if (appImageArtifacts.length > 0) {
      console.log(`  📦 Found ${appImageArtifacts.length} AppImage(s) to fix`);

      for (const artifactPath of appImageArtifacts) {
        console.log(`  🔧 Fixing sandbox in: ${artifactPath}`);

          try {
            // Make AppImage executable
          execSync(`chmod +x "${artifactPath}"`, { stdio: 'inherit' });

            // Create a temporary directory for extraction
            const tempDir = `/tmp/appimage-fix-${Date.now()}`;
            execSync(`mkdir -p "${tempDir}"`, { stdio: 'inherit' });

            // Extract AppImage
          execSync(`"${artifactPath}" --appimage-extract`, { cwd: tempDir, stdio: 'inherit' });

            // Create wrapper script in extracted directory
            const wrapperScript = `#!/bin/bash
# Fixed AppImage wrapper for sandbox issues
export ELECTRON_DISABLE_SANDBOX=1
export ELECTRON_NO_SANDBOX=1
export DISABLE_SANDBOX=1
exec "./AppRun" --no-sandbox --disable-dev-shm-usage --disable-gpu-sandbox "$@"
`;

            writeFileSync(join(tempDir, 'squashfs-root', 'AppRun-fixed'), wrapperScript);
            execSync(`chmod +x "${tempDir}/squashfs-root/AppRun-fixed"`, { stdio: 'inherit' });

            // Backup original and replace
            execSync(`mv "${tempDir}/squashfs-root/AppRun" "${tempDir}/squashfs-root/AppRun.original"`, { stdio: 'inherit' });
            execSync(`cp "${tempDir}/squashfs-root/AppRun-fixed" "${tempDir}/squashfs-root/AppRun"`, { stdio: 'inherit' });

            // Repack AppImage (need appimagetool)
            try {
              execSync(`which appimagetool`, { stdio: 'pipe' });
            execSync(`appimagetool "${tempDir}/squashfs-root" "${artifactPath}.fixed"`, { stdio: 'inherit' });
            execSync(`mv "${artifactPath}.fixed" "${artifactPath}"`, { stdio: 'inherit' });
            console.log(`  ✅ AppImage sandbox fixed with appimagetool: ${artifactPath}`);
            } catch (appimagetoolError) {
              // Fallback: try mksquashfs + elf binary modification
              console.log('  ⚠️ appimagetool not found, trying alternative method...');

              // Create new squashfs
              execSync(`mksquashfs "${tempDir}/squashfs-root" "${tempDir}/appimage.squashfs" -comp xz -all-root`, { stdio: 'inherit' });

              // This is complex - for now, just create a wrapper outside the AppImage
              const externalWrapper = `#!/bin/bash
# External wrapper for AppImage sandbox fix
export ELECTRON_DISABLE_SANDBOX=1
export ELECTRON_NO_SANDBOX=1
export DISABLE_SANDBOX=1
exec "${artifactPath}" --no-sandbox --disable-dev-shm-usage --disable-gpu-sandbox "$@"
`;

            const wrapperPath = `${artifactPath}.wrapper`;
              writeFileSync(wrapperPath, externalWrapper);
              execSync(`chmod +x "${wrapperPath}"`, { stdio: 'inherit' });

              console.log(`  ✅ Created external wrapper: ${wrapperPath}`);
            console.log(`  📝 Use ./${artifactPath.split('/').pop()}.wrapper instead of ./${artifactPath.split('/').pop()}`);
            }

            // Cleanup
            execSync(`rm -rf "${tempDir}"`, { stdio: 'inherit' });

          } catch (error) {
            console.error(`  ❌ Failed to fix AppImage: ${error.message}`);
          }
        }
      }
  }
};
