import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageJson = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
const { name, version, description, author } = packageJson;

export default {
  appId: 'tv.megacubo.megacubo',
  productName: 'Megacubo',
  copyright: `Copyright © ${new Date().getFullYear()} ${author.name}`,
  npmRebuild: false,
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,
  // Configurações para impedir inclusão automática de dependências
  includeSubNodeModules: false,

  // Configurações gerais
  directories: {
    output: 'dist',
    buildResources: 'build'
  },

  // SOLUÇÃO DEFINITIVA: Usar pasta isolada como diretório da app
  directories: {
    app: 'temp/clean-app'
  },
  asar: false,

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
    icon: 'www/icon.png',
    synopsis: description,
    description: description,

    // Configurações específicas do AppImage
    appImage: {
      systemIntegration: 'doNotAsk' // Não perguntar sobre integração no sistema
    },

    // Configurações específicas do Flatpak
    flatpak: {
      runtimeVersion: '23.08',
      baseVersion: '23.08',
      base: 'org.electronjs.Electron2.BaseApp',
      finishArgs: [
        // Permissões necessárias
        '--share=ipc',
        '--socket=x11',
        '--socket=wayland',
        '--device=dri',
        '--share=network',
        '--filesystem=host',
        '--filesystem=home',
        '--filesystem=xdg-config',
        '--filesystem=xdg-cache',
        '--filesystem=xdg-data',
        '--filesystem=xdg-documents',
        '--filesystem=xdg-download',
        '--filesystem=xdg-music',
        '--filesystem=xdg-pictures',
        '--filesystem=xdg-videos',
        '--filesystem=~/.config/megacubo:create',
        '--filesystem=~/.megacubo:create',
        '--talk-name=org.freedesktop.Notifications',
        '--talk-name=org.freedesktop.PowerManagement',
        '--talk-name=org.freedesktop.ScreenSaver',
        '--talk-name=org.gnome.SessionManager',
        '--talk-name=org.kde.StatusNotifierWatcher',
        '--system-talk-name=org.freedesktop.UDisks2',
        '--system-talk-name=org.freedesktop.UPower',
        '--system-talk-name=org.freedesktop.login1'
      ],
      modules: [
        {
          name: 'ffmpeg',
          sources: [
            {
              type: 'archive',
              url: 'https://ffmpeg.org/releases/ffmpeg-6.0.tar.xz',
              sha256: '57be87c22d9b49c112f26be5d4ae2d3143bd41c6c2fb1fd4c0b8c0e3b9dc5cd8b2'
            }
          ]
        }
      ]
    },

    // Configurações específicas do Snap
    snap: {
      confinement: 'strict',
      grade: 'stable',
      summary: 'A intuitive, multi-language and cross-platform IPTV player',
      description: description,
      plugs: [
        'default',
        'audio-playback',
        'audio-record',
        'avahi-control',
        'bluetooth-control',
        'bluez',
        'browser-support',
        'camera',
        'cups-control',
        'desktop',
        'desktop-legacy',
        'gsettings',
        'hardware-observe',
        'home',
        'locale-control',
        'mount-observe',
        'network',
        'network-bind',
        'network-control',
        'network-manager',
        'network-manager-observe',
        'network-status',
        'opengl',
        'pulseaudio',
        'removable-media',
        'screen-inhibit-control',
        'shutdown',
        'system-observe',
        'unity7',
        'upower-observe',
        'x11'
      ],
      slots: [
        {
          'megacubo-config': {
            interface: 'content',
            content: 'megacubo-config',
            read: [
              '$SNAP_COMMON',
              '$SNAP_DATA'
            ]
          }
        }
      ],
      parts: [
        {
          'ffmpeg-part': {
            plugin: 'nil',
            'override-build': `
              snapcraftctl build
              wget -O ffmpeg.tar.xz https://ffmpeg.org/releases/ffmpeg-6.0.tar.xz
              tar -xf ffmpeg.tar.xz
              cd ffmpeg-6.0
              ./configure --prefix=$SNAPCRAFT_PART_INSTALL --enable-gpl --enable-libx264 --enable-libx265 --enable-libvpx --enable-libfreetype --enable-libharfbuzz --enable-libass --enable-libfribidi --enable-libmp3lame --enable-libopus --enable-libvorbis --enable-libtheora --enable-libxvid --enable-libfontconfig --enable-libbluray --enable-libzmq --enable-libzvbi --enable-version3 --enable-nonfree --disable-static --enable-shared
              make -j$(nproc)
              make install
            `
          }
        }
      ]
    },

    // Configurações específicas do DEB
    deb: {
      depends: [
        'libnss3-dev',
        'libatk-bridge2.0-dev',
        'libdrm2',
        'libxkbcommon-dev',
        'libxcomposite-dev',
        'libxdamage-dev',
        'libxrandr-dev',
        'libgbm-dev',
        'libxss1',
        'libasound2-dev',
        'libgtk-3-dev',
        'libgconf-2-4'
      ]
    },

    // Configurações específicas do RPM
    rpm: {
      depends: [
        'nss',
        'atk',
        'drm-utils',
        'xorg-x11-server-Xvfb',
        'gtk3',
        'libXScrnSaver',
        'alsa-lib',
        'GConf2'
      ]
    }
  },

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
    publisherName: author.name,
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
    icon: 'default_icon.icns',
    category: 'public.app-category.entertainment',
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

  // Hook simplificado - como node_modules já está excluído, este hook tem efeito limitado
  // mas pode ser útil para outros tipos de arquivo
  onNodeModuleFile: (file) => {
    // Como node_modules está excluído na configuração files,
    // este hook tem pouco efeito, mas mantemos por segurança
    return 'exclude';
  },
  // Configurações de Electron
  electronVersion: packageJson.devDependencies.electron.replace('^', ''),
  asar: false,
  // Hooks de build (solução otimizada)
  beforeBuild: async (context) => {
    console.log('🔨 Iniciando build do Megacubo...');
    console.log('📦 Plataforma:', context.platform.nodeName);
    console.log('🏗️ Arquitetura:', context.arch);
    console.log('📋 Tipo de build:', context.targets.map(t => t.name).join(', '));
  },

  afterPack: async (context) => {
    console.log('✅ Build concluído - arquivos otimizados!');
  },

  afterBuild: async (context) => {
    console.log('✅ Build concluído!');
    console.log('📦 Artefatos gerados:', context.outDir);
    context.targets.forEach(target => {
      console.log(`  - ${target.name}: ${target.outDir}`);
    });
  },

  afterAllArtifactBuild: async (buildResult) => {
    console.log('🎉 Todos os artefatos foram criados com sucesso!');
    console.log('📦 Artefatos finais:');
    buildResult.forEach(artifact => {
      console.log(`  - ${artifact}`);
    });
  }
};
