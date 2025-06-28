<!-- docs/installation.md -->

# <span style="color: #2e86de;">Installation</span>

This guide covers how to install **Megacubo** on various platforms.

## Installing on Windows

1. Visit [megacubo.tv](https://megacubo.tv). 
2. Download the latest `.exe` installer for your system:
   - **Windows x64**: `Megacubo_X.X.X_win_x64.exe`
   - **Windows x86**: `Megacubo_X.X.X_win_x86.exe`
   - **Windows ARM64**: `Megacubo_X.X.X_win_arm64.exe`
3. Run the installer and follow the instructions.
4. Launch Megacubo after installation completes.

### Portable Mode (Windows/Linux)

To run Megacubo in portable mode:
1. **During installation (Windows)**: Select "Portable Mode" option in the installer
2. **Manual activation**: Create the folder `www/nodejs/.portable/` in the installation directory and restart the app

Portable mode allows you to run the app from USB drives or external storage without installation.

## Installing on macOS

1. Go to [megacubo.tv](https://megacubo.tv). 
2. Download the `.dmg` file (`Megacubo_X.X.X_macos.dmg`).
3. Drag the app into your Applications folder.
4. Open the app from Finder or Launchpad.

### macOS Security Notes

Megacubo is not signed for Mac, so to run the app, follow these steps:

1. **Right-click** on the Megacubo app in Applications
2. Select **Open** from the context menu
3. Click **Open** in the security dialog that appears

For detailed instructions, see:
- [How to Open an Unsigned App](https://www.howtogeek.com/205393/gatekeeper-101-why-your-mac-only-allows-apple-approved-software-by-default/)
- [Apple Support Guide (Portuguese)](https://support.apple.com/pt-br/guide/mac-help/mh40616/mac)

> **Note**: For some releases, Mac versions may not be available due to signing issues. Check the download page for the latest available version.

## Installing on Linux

### Quick Installation (Recommended)

Run this command in your terminal:

```bash
wget -qO- https://megacubo.tv/install.sh | bash
```

### Manual Installation

1. Download the appropriate `.tar.gz` file:
   - **Linux x64**: `Megacubo_X.X.X_linux_x64.tar.gz`
   - **Linux ARM64**: `Megacubo_X.X.X_linux_arm64.tar.gz`
2. Extract the archive:
   ```bash
   tar -xzf Megacubo_X.X.X_linux_x64.tar.gz
   ```
3. Run the executable:
   ```bash
   ./Megacubo
   ```

### Uninstalling on Linux

To uninstall Megacubo:

```bash
wget -qO- https://megacubo.tv/uninstall.sh | bash
```

### AppImage Support

Some releases include `.AppImage` files for easier installation on Linux distributions.

## Installing on Android / TV Box

1. Enable **Unknown Sources** in your device settings.
2. Use the Downloader app to access: https://megacubo.tv/
3. Download the `.apk` file (`Megacubo_X.X.X_android.apk`).
4. Install the APK file.
5. Launch the app and begin setup.

### Android Installation Notes

If you run into an error when installing a new version:
1. **Uninstall the old version** first
2. **Install the new version** again

### Android Permissions

The app will request the following permissions:
- **Storage**: For caching and file management
- **Internet**: For streaming content
- **Wake Lock**: To prevent sleep during playback
- **Network State**: For connection monitoring on casting features (Premium)

## Troubleshooting Installation Issues

### Antivirus Blocks Installation
This is usually a false positive. Add the file to your antivirus exceptions.

### Installer Fails
Try running as administrator or disable any background security tools.

### App Won't Launch
Reinstall or try the portable version if available.

## Post-Installation Setup

After successful installation:

1. **Launch the app** for the first time
2. **Follow the setup wizard** to configure preferences
3. **Add your first IPTV list** or enable Community Mode
4. **Test a channel** to ensure everything works

## Updating Megacubo

### Manual Updates
- Download the latest version from [megacubo.tv](https://megacubo.tv)
- Install over the existing version
- Your settings and lists will be preserved

### Checking for Updates
- The app may notify you when new versions are available
- You can also check manually by visiting the official website

## Backup and Restore

### Exporting Settings
1. Go to **Options** > **Export | Import**
2. Click **Export Settings**
3. Save the configuration file

### Importing Settings
1. Go to **Options** > **Export | Import**
2. Click **Import Settings**
3. Select your saved configuration file

---

*If you encounter any issues during installation, please check our [Troubleshooting](troubleshooting.md) guide, visit our [website](https://megacubo.tv/en/english/), or contact our support team at contact@megacubo.tv.*