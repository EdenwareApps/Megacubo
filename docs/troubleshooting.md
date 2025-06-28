<!-- docs/troubleshooting.md -->

[🏠](/README.md) > [Troubleshooting](troubleshooting.md)

# <span style="color: #2e86de;">Troubleshooting</span>

## Common Errors and Fixes

| Error | Solution |
|-------|----------|
| Can't load list | Verify URL or check internet connection |
| Playback keeps buffering | Enable Low-end Device Mode or switch transmission |
| App won't launch | Reinstall or check for antivirus interference |
| No audio | Check output device or toggle audio track |
| Black screen | Disable hardware acceleration in advanced settings |
| High memory usage | Enable "For slow devices" mode in performance settings |

## Testing Different Transmissions

If a channel doesn't work:

1. Click the circular arrows icon.
2. The app will test alternative transmissions automatically.

## Generating Diagnostic Reports

### Debug Logs
1. **Windows**: Run `megacubo-debug.cmd` in the installation folder
2. **Linux**: Run `megacubo-debug.sh` in the installation folder
3. **Android**: Use developer options in the app

### Developer Options
1. Go to **Options** > **Advanced** > **Developer options**
2. Enable debug features for troubleshooting
3. Access advanced settings and logs

## Dealing with Antivirus False Positives

Some antivirus programs incorrectly flag Megacubo:

1. Add the app folder to your antivirus exceptions.
2. Whitelist the domain `megacubo.tv`.
3. Restart the app.

### Security Information
- **No malware execution**: No security vulnerabilities from list content
- **URL validation**: Automatic validation of stream URLs
- **Local processing**: Most data processed locally on your device

## Audio and Video Problems

### No Audio
1. Check your system volume
2. Verify audio output device
3. Try switching audio tracks (three-dot menu > More options > Select audio)
4. Restart the app

### Video Issues
1. **Black screen**: Disable hardware acceleration
2. **Poor quality**: Check your internet speed (minimum 200KBps)
3. **Lag**: Enable performance mode
4. **No video**: Try a different channel

### Quality Selection
- **Available options**: Three-dot menu > More options > Select quality
- **Single quality**: If option missing, stream only has one quality level
- **Auto adjustment**: App automatically selects best quality for your connection

## App Performance Issues

### Memory Usage
- **High memory**: Enable "For slow devices" mode in performance settings
- **Cache management**: Clear cache in Options > Advanced > Developer options
- **List reduction**: Load fewer lists simultaneously

### Slow Loading
- **Clear cache** in Options > Advanced > Developer options
- **Restart the app**
- **Check available memory**
- **Disable unnecessary features**

### Crashes
1. **Update to latest version**
2. **Clear app data**
3. **Reinstall the app**
4. **Check system requirements**

## Advanced Troubleshooting

### Debug Mode
1. **Enable developer options**: Options > Advanced > Developer options
2. **Access debug logs**: Run megacubo-debug script
3. **Monitor performance**: Check memory and CPU usage

### Performance Monitoring
- **Memory usage**: Monitor through system task manager
- **CPU usage**: Normal during playback, minimal when idle
- **Network usage**: 200KBps to 2MBps per active stream

### Cache Management
- **Disk cache**: Enable in Options > Advanced > Developer options
- **Cache limit**: Default 1GB, adjustable
- **Automatic cleanup**: Old cache files removed automatically

## Getting Additional Help

If the above solutions don't work:

1. **Generate a diagnostic report** using debug tools
2. **Check the FAQ section**
3. **Visit our website**: [megacubo.tv](https://megacubo.tv/en/english/)
4. **Email support** at contact@megacubo.tv
5. **Facebook Page**: [facebook.com/MegacuboTV](https://www.facebook.com/MegacuboTV)

## Prevention Tips

- **Keep the app updated**
- **Use reliable IPTV lists**
- **Maintain good internet connection** (minimum 200KBps)
- **Regularly clear cache**
- **Backup your settings** using export feature
- **Monitor system resources** on older devices

## Platform-Specific Issues

### Windows
- **Antivirus interference**: Add to exceptions
- **Permission issues**: Run as administrator if needed
- **Portable mode**: Create `www/nodejs/.portable/` folder

### Android
- **Permission issues**: Grant all required permissions
- **Storage access**: Ensure storage permissions are enabled
- **Background operation**: May be affected by battery optimization

### Linux
- **Permission issues**: Check file permissions
- **Dependencies**: Ensure required libraries are installed
- **Process isolation**: Limited to two worker processes

---

*Most issues can be resolved with these troubleshooting steps. If problems persist, please contact our support team with your diagnostic report.*

**Next:** [Support & Contact](support.md)
**Previous:** [Installation](installation.md)