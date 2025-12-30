
---
title: "Develop Megacubo IPTV Player From Source - Open Source Guide"
description: "Complete development setup guide for Megacubo IPTV player - build from source, contribute to open source IPTV project, and join streaming app development"
keywords: "IPTV player development, Megacubo build setup, open source IPTV contribution, streaming app development, IPTV source code, live TV app development"
---

<!-- docs/developing.md -->

[🏠](/README.md) > IPTV Development

# <span style="color: #2e86de;">IPTV Player Development Setup</span>

### IPTV Development with Electron (Windows/Linux/macOS)
Easier and recommended way for **desktop IPTV app development**.
```
git clone https://github.com/EdenwareApps/Megacubo.git
cd Megacubo
npm install
npm run prepare  # Compiles and bundles the application
npm run debug    # Starts app in development mode with debugging
```

See [contributing guide](contributing.md#requirements) for system requirements.

#### Build Commands:
```bash
# Prepare project (compile and bundle)
npm run prepare

# Build optimized installers
npm run build:electron:linux    # Linux (AppImage, Snap, Flatpak)
npm run build:electron:win      # Windows (NSIS, MSI)
npm run build:electron:mac      # macOS (DMG)
npm run build:electron:all      # All platforms

# Traditional builds (includes all dependencies)
npm run build:electron:linux
npm run build:electron:win
npm run build:electron:mac
```

### With Capacitor (Android):
```
git clone https://github.com/EdenwareApps/Megacubo.git
cd Megacubo
npm i
npx cap sync
npx cap open android
```

### With NPM (install globally):
```
npm i -g megacubo
npx megacubo
```

## See Also

- **[Building](building.md)** - How to build Megacubo installers
- **[Contributing](contributing.md)** - How to contribute to the project
- **[Installation](installation.md)** - Installing Megacubo (for users)

---

[🏠](/README.md) | [Building](building.md) | [Contributing](contributing.md)Any errors along the way? [Let us know](https://github.com/EdenwareApps/Megacubo/issues).
