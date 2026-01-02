<!-- docs/building.md -->

[🏠](/README.md) > [Development](developing.md) > Building

# <span style="color: #2e86de;">Building Megacubo IPTV Player</span>

This guide provides instructions for **building IPTV player installers** for **Windows IPTV app**, **Linux IPTV software**, and **macOS IPTV player** using electron-builder.

## Prerequisites

### IPTV Player Build Requirements

Ensure you have **Node.js** (version 18 or higher) and **npm** installed on your system for building the IPTV streaming application.

### System Dependencies

#### Windows

For Windows builds, you need:

```cmd
# No additional system dependencies required for basic builds
# For MSI builds, ensure you have Windows SDK installed
```

#### macOS

For macOS builds, you need Xcode Command Line Tools:

```bash
xcode-select --install
```

#### Linux

To build different Linux installer formats, you need to install the following dependencies:

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
  libXScrnSaver-devel \
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
  snapcraft \
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

### Flatpak Setup (Linux only)

After installing flatpak, add the Flathub repository:

```bash
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install flathub org.freedesktop.Platform//23.08
flatpak install flathub org.freedesktop.Sdk//23.08
flatpak install flathub org.electronjs.Electron2.BaseApp
```

### Snap Setup (Linux only)

Make sure snapd is running:

```bash
sudo systemctl enable --now snapd.socket
sudo ln -s /var/lib/snapd/snap /snap
```

## Installing Node.js Dependencies

```bash
npm install
```

> **Note:** If you encounter disk space issues during installation, consider clearing the npm cache:
> ```bash
> npm cache clean --force
> ```

## Preparing the Project

Before building, you need to prepare the project (compile and bundle the code):

```bash
npm run prepare
```

This command:
- Compiles TypeScript/JavaScript files
- Bundles the application code
- Generates necessary assets in `www/nodejs/dist/`
- Prepares everything needed for electron-builder

> **Important:** Always run `npm run prepare` before any build command. The optimized builds require this step to function properly.

## Build Commands

### Optimized Builds (Recommended)

#### All Platforms
```bash
npm run build:electron:all
```

#### Specific Platforms
```bash
npm run build:electron:win    # Windows MSI installer (~100MB)
npm run build:electron:linux  # Linux AppImage (~100MB)
npm run build:electron:mac    # macOS DMG (~100MB)
```

**Installer Types:**
- **MSI**: Windows installer with uninstaller in Control Panel
- **AppImage**: Portable Linux application that runs on most distributions
- **DMG**: macOS disk image installer

### Optimized Builds (Only Available)

**⚠️ WARNING:** Only optimized builds are available to prevent accidental generation of bloated ~4GB installers.

```bash
# All platforms
npm run build:electron:all

# Specific platforms
npm run build:electron:linux    # Linux AppImage
npm run build:electron:win      # Windows MSI
npm run build:electron:mac      # macOS DMG
```

## Structure of Generated Files

After building, the installers will be created in the `dist/` directory:

### Windows
```
dist/
├── megacubo-17.6.2.msi              # MSI installer (recommended)
└── megacubo Setup 17.6.2.exe        # NSIS installer
```

### Linux
```
dist/
├── Megacubo-17.6.2.AppImage          # AppImage (recommended)
├── megacubo_17.6.2_amd64.snap        # Snap
├── tv.megacubo.app.flatpak      # Flatpak
├── megacubo_17.6.2_amd64.deb         # Debian/Ubuntu
└── megacubo-17.6.2.x86_64.rpm        # Fedora/RHEL
```

### macOS
```
dist/
├── Megacubo-17.6.2.dmg               # DMG installer (recommended)
└── Megacubo-17.6.2-mac.zip           # ZIP archive
```

## Troubleshooting

### Cross-Platform Issues

### Problem: "electron-builder: command not found"
**Solution:** Run `npm install` to install dependencies.

### Problem: "Cannot find module" errors
**Solution:** Run `npm run prepare` before building.

### Problem: Build hangs or runs out of memory
**Solution:** Close other applications and ensure at least 4GB RAM available.

### Problem: "no such file or directory" errors
**Solution:** Ensure `www/nodejs/dist/` exists. Run `npm run prepare` first.

### Windows-Specific Issues

### Problem: MSI build fails with "Icon not found"
**Solution:** Ensure `build/icon.ico` exists. Copy your icon to this location.

### Problem: "Megacubo still open" during installation
**Solution:** Close all Megacubo processes and delete previous installation.

### Problem: Installer size too large (>1GB)
**Solution:** Use `npm run build:electron:win`.

### Linux-Specific Issues

### Problem: "flatpak-builder: command not found"
**Solution:** Install flatpak-builder as described above.

### Problem: "snapcraft: command not found"
**Solution:** Install snapcraft as described above.

### Problem: Permission error with Snap
**Solution:** Run as root or configure snapcraft to use classic mode.

### Problem: FFmpeg compilation failure on Flatpak
**Solution:** Ensure all development dependencies are installed.

### Problem: AppImage does not run
**Solution:** Make sure FUSE is installed and properly configured.

### macOS-Specific Issues

### Problem: "Code signing required"
**Solution:** For development, use `--publish=never`. For distribution, configure code signing.

### Problem: DMG creation fails
**Solution:** Ensure Xcode Command Line Tools are installed.

### Problem: "Cannot build for macOS on Windows"
**Solution:** macOS builds require macOS environment. Use cross-compilation if available.

## Distribution

### Windows
- **MSI**: Recommended for enterprise deployment and Windows Store
- **NSIS**: Traditional installer with setup wizard

### Linux
- **AppImage**: Portable format, runs on any Linux distribution
- **Flatpak**: Publish on Flathub for wide distribution
- **Snap**: Publish on Snap Store (Ubuntu Software Center)
- **DEB**: Ubuntu/Debian package repositories
- **RPM**: Fedora/RHEL package repositories

### macOS
- **DMG**: Native macOS installer format
- **ZIP**: Simple archive for manual installation

### Automated Publishing

For automated publishing to GitHub Releases:

```bash
npm run build:electron:publish  # Builds and publishes all platforms
```

This will create GitHub releases with installers for all supported platforms.

## Development

### Local Development Builds

For testing without publishing:

```bash
# Optimized builds
npm run build:electron:win -- --publish=never
npm run build:electron:linux -- --publish=never
npm run build:electron:mac -- --publish=never
```

### Production Builds

For production builds with automatic publishing to GitHub:

```bash
npm run build:electron:publish  # All platforms
```

## See Also

- **[Development Setup](developing.md)** - How to set up your development environment
- **[Contributing](contributing.md)** - How to contribute to the project
- **[Installation](installation.md)** - Installing Megacubo (for users)

---

[🏠](/README.md) | [Development](developing.md) | [Contributing](contributing.md)
