#!/usr/bin/env node
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

console.log('🚀 Iniciando build otimizado do Megacubo (SEM ASAR)...');

// 1. Preparar pasta clean-app
console.log('🧹 Preparando pasta clean-app...');
rmSync(join(rootDir, 'temp'), { recursive: true, force: true });
mkdirSync(join(rootDir, 'temp', 'clean-app'), { recursive: true });
mkdirSync(join(rootDir, 'temp', 'clean-app', 'dist'), { recursive: true });

// 2. Copiar apenas arquivos essenciais para a pasta dist
console.log('📋 Copiando arquivos essenciais para dist/...');
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
    console.warn(`  ⚠ ${file} não encontrado`);
  }
});

// Copiar dados essenciais para dist
console.log('📊 Copiando dados essenciais para dist/...');
const dataDirs = ['dayjs-locale', 'defaults'];
dataDirs.forEach(dir => {
  const src = join(rootDir, 'www', 'nodejs', 'dist', dir);
  const dest = join(rootDir, 'temp', 'clean-app', 'dist', dir);
  try {
    execSync(`cp -r "${src}" "${dest}"`, { stdio: 'pipe' });
    console.log(`  ✓ dist/${dir}`);
  } catch (e) {
    console.warn(`  ⚠ ${dir} não encontrado`);
  }
});

// Copiar node_modules e windows.vbs para dist
console.log('📦 Copiando node_modules e windows.vbs para dist/...');
try {
  execSync(`cp -r "${join(rootDir, 'www', 'nodejs', 'dist', 'node_modules')}" "${join(rootDir, 'temp', 'clean-app', 'dist')}"`, { stdio: 'pipe' });
  console.log(`  ✓ dist/node_modules`);
} catch (e) {
  console.warn(`  ⚠ node_modules não encontrado`);
}

try {
  copyFileSync(join(rootDir, 'www', 'nodejs', 'dist', 'windows.vbs'), join(rootDir, 'temp', 'clean-app', 'dist', 'windows.vbs'));
  console.log(`  ✓ dist/windows.vbs`);
} catch (e) {
  console.warn(`  ⚠ windows.vbs não encontrado`);
}

// 3. Copiar pastas lang e renderer
console.log('🌍 Copiando pastas lang e renderer...');
const sourceDirs = ['lang', 'renderer'];
sourceDirs.forEach(dir => {
  const src = join(rootDir, 'www', 'nodejs', dir);
  const dest = join(rootDir, 'temp', 'clean-app', dir);
  try {
    execSync(`cp -r "${src}" "${dest}"`, { stdio: 'pipe' });
    console.log(`  ✓ ${dir}/`);
  } catch (e) {
    console.warn(`  ⚠ ${dir} não encontrado`);
  }
});

// 4. Criar package.json da app
console.log('📄 Criando package.json da aplicação...');
const appPackageJson = {
  name: 'megacubo-app',
  version: '17.6.2',
  main: 'dist/main.js',
  dependencies: {}
};
writeFileSync(join(rootDir, 'temp', 'clean-app', 'package.json'), JSON.stringify(appPackageJson, null, 2));

// 5. Detectar plataforma e executar build SEM ASAR
const targetPlatform = process.argv[2] || 'win'; // win, linux, mac, ou all
console.log(`🔨 Executando build para ${targetPlatform} (criando pasta descompactada)...`);

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
  console.error('❌ Erro durante o build:', error.message);
  process.exit(1);
}

// 6. Detectar e processar estrutura baseada na plataforma
console.log('📦 Convertendo para estrutura sem ASAR...');

// Função para encontrar a pasta descompactada baseada na plataforma
function findUnpackedDir() {
  const distDir = join(rootDir, 'dist');

  // Procurar por pastas descompactadas em diferentes padrões
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

  // Fallback: procurar recursivamente
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
  console.error('❌ ERRO: Não foi possível encontrar a pasta descompactada!');
  process.exit(1);
}

const { unpackedDir, resourcesDir } = dirInfo;
const appDir = join(resourcesDir, 'app');
console.log(`  📁 Pasta encontrada: ${unpackedDir}`);

// Remover ASAR se existir
try {
  rmSync(join(resourcesDir, 'app.asar'), { recursive: true, force: true });
  rmSync(join(resourcesDir, 'app.asar.unpacked'), { recursive: true, force: true });
} catch (e) {
  // Ignorar se não existir
}

// Criar pasta app e copiar arquivos
mkdirSync(appDir, { recursive: true });
execSync(`cp -r "${join(rootDir, 'temp', 'clean-app')}"/* "${appDir}/"`, { stdio: 'inherit' });

// 7. Compilar premium.js para premium.jsc e REMOVER premium.js
console.log('🔒 Compilando premium.js para bytecode (.jsc)...');
const appDistDir = join(appDir, 'dist');
const premiumJsPath = join(appDistDir, 'premium.js');
const premiumJscPath = join(appDistDir, 'premium.jsc');

let compilationSuccess = false;

try {
  execSync(`cd "${appDistDir}" && node -e "const bytenode = require('./node_modules/bytenode'); bytenode.compileFile('premium.js', 'premium.jsc'); console.log('premium.jsc compiled successfully');"`, { stdio: 'inherit' });
  console.log('  ✓ premium.jsc criado com sucesso');
  compilationSuccess = true;
} catch (error) {
  console.warn('  ⚠ Falha ao compilar premium.jsc:', error.message);
}

// REMOVER premium.js independentemente do resultado da compilação
try {
  rmSync(premiumJsPath, { force: true });
  console.log('  ✓ premium.js removido da distribuição');
} catch (error) {
  console.warn('  ⚠ Não foi possível remover premium.js:', error.message);
}

// Verificar se pelo menos o premium.jsc existe
if (existsSync(premiumJscPath)) {
  console.log('  ✅ Premium bytecode pronto para distribuição');
} else {
  console.error('  ❌ ERRO: Arquivo premium.jsc não foi criado!');
  process.exit(1);
}

// 8. Adicionar arquivo cast_channel.proto
console.log('🔧 Adicionando arquivo cast_channel.proto...');
copyFileSync(join(rootDir, 'www', 'nodejs', 'dist', 'cast_channel.proto'), join(appDistDir, 'cast_channel.proto'));

// 9. Ajustar package.json (remover type: module)
console.log('📝 Ajustando package.json...');
const appPackagePath = join(appDir, 'package.json');
const appPackage = JSON.parse(readFileSync(appPackagePath, 'utf8'));
delete appPackage.type; // Remove type: "module"
writeFileSync(appPackagePath, JSON.stringify(appPackage, null, 2));

// 10. Criar instalador final baseado na plataforma
console.log(`📦 Criando instalador para ${targetPlatform}...`);
let installerCommand;

switch (targetPlatform) {
  case 'win':
    installerCommand = `npx electron-builder --win nsis --publish=never --prepackaged "${unpackedDir}"`;
    break;
  case 'linux':
    installerCommand = `npx electron-builder --linux AppImage --publish=never --prepackaged "${unpackedDir}"`;
    break;
  case 'mac':
    installerCommand = `npx electron-builder --mac dmg --publish=never --prepackaged "${unpackedDir}"`;
    break;
  default:
    installerCommand = `npx electron-builder --win nsis --linux AppImage --mac dmg --publish=never --prepackaged "${unpackedDir}"`;
}

try {
  execSync(installerCommand, { stdio: 'inherit', cwd: rootDir });
  console.log('✅ Instalador criado com sucesso!');
} catch (error) {
  console.warn('⚠️ Erro na criação do instalador:', error.message);
  console.log('📁 Mas a proteção premium foi aplicada com sucesso na pasta descompactada!');
  console.log(`📂 Pasta pronta: ${unpackedDir}`);
}

// 11. Limpar pasta temp
console.log('🧹 Limpando arquivos temporários...');
rmSync(join(rootDir, 'temp'), { recursive: true, force: true });

console.log('✅ Build otimizado concluído (SEM ASAR)!');
console.log('📊 Verifique o tamanho do instalador em dist/*.exe');
console.log('📁 Estrutura final:');
console.log('  - Arquivos compilados: dist/win-unpacked/resources/app/dist/');
console.log('  - Idiomas: dist/win-unpacked/resources/app/lang/');
console.log('  - Renderer: dist/win-unpacked/resources/app/renderer/');
