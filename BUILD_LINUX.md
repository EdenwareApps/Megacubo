# Building Megacubo for Linux

This document provides instructions for building Linux installers (AppImage, Flatpak, Snap) using electron-builder.

## Prerequisites

### System Dependencies

To build the different Linux installer formats, you need to install the following dependencies:

#### Ubuntu/Debian
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

#### Fedora/RHEL/CentOS
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

#### Arch Linux
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

### Flatpak Setup

After installing flatpak, add the Flathub repository:

```bash
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install flathub org.freedesktop.Platform//23.08
flatpak install flathub org.freedesktop.Sdk//23.08
flatpak install flathub org.electronjs.Electron2.BaseApp
```

### Snap Setup

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

## Build Commands

### All Linux formats
```bash
npm run build:electron-builder:linux
```

### AppImage
```bash
npm run build:electron-builder:linux:appimage
```

### Flatpak
```bash
npm run build:electron-builder:linux:flatpak
```

### Snap
```bash
npm run build:electron-builder:linux:snap
```

### DEB (Debian/Ubuntu)
```bash
npm run build:electron-builder:linux:deb
```

### RPM (Fedora/RHEL)
```bash
npm run build:electron-builder:linux:rpm
```

## Structure of Generated Files

After building, the installers will be created in the `dist-electron/` directory:

```
dist-electron/
├── Megacubo-17.6.2.AppImage          # AppImage
├── megacubo_17.6.2_amd64.snap        # Snap
├── tv.megacubo.megacubo.flatpak      # Flatpak
├── megacubo_17.6.2_amd64.deb         # Debian
└── megacubo-17.6.2.x86_64.rpm        # RPM
```

## Troubleshooting

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

## Distribution

The generated installers can be distributed through:

- **AppImage**: Can be run directly on any Linux distribution
- **Flatpak**: Publish on Flathub
- **Snap**: Publish on Snap Store
- **DEB/RPM**: Linux distribution package repositories

## Development

For local development, use:

```bash
npm run build:electron-builder:linux:appimage -- --publish=never
```

For production builds with automatic publishing:

```bash
npm run build:electron-builder:publish
```
