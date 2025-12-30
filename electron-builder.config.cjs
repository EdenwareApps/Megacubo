const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const { name, version, description, author } = packageJson;

console.log('🔧 LOADING electron-builder.config.js WITH BYTENODE HOOK...');

module.exports = {
  appId: 'tv.megacubo.app',
  productName: 'Megacubo',
  executableName: 'Megacubo',
  copyright: `Copyright © ${new Date().getFullYear()} ${author.name}`,

  // Configurações gerais
  directories: {
    output: 'dist_optimized',
    buildResources: 'build'
  },

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
    '!android/**',  // Excluir diretório android completo
    '!node_modules/**',  // Excluir QUALQUER node_modules da raiz
    '!**/android/**',  // Excluir QUALQUER pasta android em qualquer lugar
    '!**/*.so',  // Excluir bibliotecas nativas não-Windows (.so = Linux)
    '!**/*.dylib',  // Excluir bibliotecas macOS (.dylib)
    '!**/build/**',  // Excluir pastas de build desnecessárias
    '!www/nodejs/dist/node_modules/**'  // Excluir TODAS as dependências node_modules
  ],

  // Configurações específicas por plataforma
  linux: {
    target: [
      {
        target: 'AppImage',
        arch: ['x64', 'arm64']
      },
      {
        target: 'flatpak',
        arch: ['x64', 'arm64']
      },
      {
        target: 'snap',
        arch: ['x64', 'arm64']
      },
      {
        target: 'deb',
        arch: ['x64', 'arm64']
      },
      {
        target: 'rpm',
        arch: ['x64', 'arm64']
      }
    ],
    category: 'Video',
    icon: 'www/nodejs/default_icon.png',
    synopsis: description,
    description: description,
    name: 'Megacubo', // Força nome maiúsculo no Linux
    executableName: 'Megacubo' // Nome do executável no Linux
  },

  win: {
    target: [
      {
        target: 'msi',
        arch: ['x64', 'ia32']
      }
    ],
    name: 'Megacubo', // Força nome maiúsculo no Windows
    executableName: 'Megacubo', // Nome do executável no Windows
    publisherName: author.name,
    verifyUpdateCodeSignature: false
  },

  msi: {
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    runAfterFinish: true,
    perMachine: false,
    oneClick: false,
    removeOldVersion: true,
    artifactName: 'Megacubo-${version}.${ext}' // Nome do instalador MSI
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
    category: 'public.app-category.entertainment',
    name: 'Megacubo', // Força nome maiúsculo no macOS
    executableName: 'Megacubo', // Nome do executável no macOS
    darkModeSupport: true,
    hardenedRuntime: true,
    gatekeeperAssess: false
  },

  // Configurações de publicação (opcional)
  publish: {
    provider: 'github',
    owner: 'EdenwareApps',
    repo: 'Megacubo',
    releaseType: 'release'
  },

  // Configurações de build
  buildVersion: version,
  compression: 'maximum',
  // Nota: node-gyp não é mais necessário pois o jexidb foi atualizado
  // e não usa mais msgpack como dependência opcional
  beforeBuild: async (context) => {
    console.log('🔨 Iniciando build do Megacubo...');
    console.log('📦 Plataforma:', context.platform.nodeName);
    console.log('🏗️ Arquitetura:', context.arch);
    console.log('🔧 CONFIG FILE LOADED: electron-builder.config.js');
  },
  afterPack: async (context) => {
    console.log('✅ Build finished - optimized files!');
    console.log('🔒 Premium bytecode compilation handled by optimized build script');
  },

  // Configurações de Electron
  electronVersion: require('./package.json').devDependencies.electron.replace('^', ''),
  asar: false, // Desabilitar ASAR para reduzir problemas de espaço

  // Hooks de build
  beforeBuild: async (context) => {
    console.log('🔨 Iniciando build do Megacubo...');
    console.log('📦 Plataforma:', context.platform?.nodeName);
    console.log('🏗️ Arquitetura:', context.arch);
    console.log('🔧 CONFIG FILE LOADED: electron-builder.config.cjs');
  },


  afterAllArtifactBuild: async (buildResult) => {
    console.log('🎉 Todos os artefatos foram criados com sucesso!');
    console.log('📦 Artefatos finais:');
    if (Array.isArray(buildResult)) {
    buildResult.forEach(artifact => {
      console.log(`  - ${artifact}`);
    });
    } else {
      console.log(`  - ${buildResult}`);
    }
  }
};
