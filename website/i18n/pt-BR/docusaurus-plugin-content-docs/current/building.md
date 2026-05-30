[🏠](/docs/introduction) > [Desenvolvimento](developing.md) > Construção

# Construindo o Megacubo IPTV Player

Este guia fornece instruções para **construir instaladores do player IPTV** para **Windows IPTV app**, **Linux IPTV software** e **macOS IPTV player** usando o electron-builder.

## Pré-requisitos

### Requisitos para construir o player IPTV

Certifique-se de ter **Node.js** (versão 18 ou superior) e **npm** instalados em seu sistema para construir o aplicativo de streaming IPTV.

### Dependências do sistema

#### Windows

Para builds no Windows, você precisa de:

```cmd
# Nenhuma dependência adicional do sistema é necessária para builds básicos
# Para builds MSI, certifique-se de ter o Windows SDK instalado
```

#### macOS

Para builds no macOS, você precisa das Ferramentas de Linha de Comando do Xcode:

```bash
xcode-select --install
```

#### Linux

Para construir diferentes formatos de instalador Linux, você precisa instalar as seguintes dependências:

##### Ubuntu/Debian
```bash
sudo apt update
sudo apt install -y \
  flatpak \
  flatpak-builder \
  snapd \
  snapcraft \
  fuse \
  libnss3-dev \
  libatk-bridge2.0-dev \
  libdrm2 \
  libxkbcommon-dev \
  libxcomposite-dev \
  libxdamage-dev \
  libxrandr-dev \
  libgbm-dev \
  libxss1 \
  libasound2-dev \
  libgtk-3-dev \
  libgconf-2-4 \
  rpm \
  dpkg-dev
```

##### Fedora/RHEL/CentOS
```bash
sudo dnf install -y \
  flatpak \
  flatpak-builder \
  snapd \
  snapcraft \
  fuse \
  libnss3-devel \
  libatk-bridge2.0-devel \
  libdrm-devel \
  libxkbcommon-devel \
  libXcomposite-devel \
  libXdamage-devel \
  libXrandr-devel \
  libgbm-devel \
  libXScrSaver-devel \
  alsa-lib-devel \
  gtk3-devel \
  GConf2-devel \
  rpm-build
```

##### Arch Linux
```bash
sudo pacman -S \
  flatpak \
  flatpak-builder \
  snapd \
  fuse2 \
  nss \
  atk \
  libdrm \
  libxkbcommon \
  libxcomposite \
  libxdamage \
  libxrandr \
  libgbm \
  libxss \
  alsa-lib \
  gtk3 \
  gconf \
  rpm-tools
```

### Configuração do Flatpak (somente Linux)

Após instalar o flatpak, adicione o repositório Flathub:

```bash
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install flathub org.freedesktop.Platform//23.08
flatpak install flathub org.freedesktop.Sdk//23.08
flatpak install flathub org.electronjs.Electron2.BaseApp
```

### Configuração do Snap (somente Linux)

Certifique-se de que o snapd esteja em execução:

```bash
sudo systemctl enable --now snapd.socket
sudo ln -s /var/lib/snapd/snap /snap
```

## Instalando dependências do Node.js

```bash
npm install
```

> **Nota:** Se encontrar problemas de espaço em disco durante a instalação, considere limpar o cache do npm:
> ```bash
> npm cache clean --force
> ```

## Preparando o projeto

Antes de construir, é necessário preparar o projeto (compilar e empacotar o código):

```bash
npm run prepare
```

Este comando:
- Compila arquivos TypeScript/JavaScript
- Empacota o código do aplicativo
- Gera os ativos necessários em `www/nodejs/dist/`
- Prepara tudo que é necessário para o electron-builder

> **Importante:** Sempre execute `npm run prepare` antes de qualquer comando de build. Builds otimizados exigem esse passo para funcionar corretamente.

## Comandos de build

### Builds otimizados (recomendado)

#### Todas as plataformas
```bash
npm run build:electron:all
```

#### Plataformas específicas
```bash
npm run build:electron:win    # Windows MSI installer (~100MB)
npm run build:electron:linux  # Linux AppImage (~100MB)
npm run build:electron:mac    # macOS DMG (~100MB)
```

**Tipos de instaladores:**
- **MSI**: instalador Windows com desinstalador no Painel de Controle
- **AppImage**: aplicação portátil Linux que funciona na maioria das distribuições
- **DMG**: imagem de disco para macOS

### Builds otimizados (apenas disponíveis)

**⚠️ AVISO:** Builds otimizados estão disponíveis para evitar a geração acidental de instaladores muito grandes (~4GB).

```bash
# Todas as plataformas
npm run build:electron:all

# Plataformas específicas
npm run build:electron:linux    # Linux AppImage
npm run build:electron:win      # Windows MSI
npm run build:electron:mac      # macOS DMG
```

## Estrutura dos arquivos gerados

Após o build, os instaladores serão criados no diretório `dist/`:

### Windows
```
dist/
├── megacubo-17.6.2.msi              # Instalador MSI (recomendado)
└── megacubo Setup 17.6.2.exe        # Instalador NSIS
```

### Linux
```
dist/
├── Megacubo-17.6.2.AppImage          # AppImage (recomendado)
├── megacubo_17.6.2_amd64.snap        # Snap
├── tv.megacubo.app.flatpak           # Flatpak
├── megacubo_17.6.2_amd64.deb         # Debian/Ubuntu
└── megacubo-17.6.2.x86_64.rpm        # Fedora/RHEL
```

### macOS
```
dist/
├── Megacubo-17.6.2.dmg               # DMG (recomendado)
└── Megacubo-17.6.2-mac.zip           # arquivo ZIP
```

## Solução de problemas
