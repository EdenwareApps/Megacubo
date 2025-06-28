<!-- docs/performance.md -->

# <span style="color: #2e86de;">Performance and Optimization</span>

## Low-end Device Mode

For older computers or TV Boxes:

1. Go to **Options** > **Performance Mode**.
2. Enable **Low-end Device Mode**.
3. This disables animations and lowers video quality for smoother playback.

### Memory Management

To reduce memory usage:
1. Go to **Options** > **Performance Mode** > **For slow devices**
2. This reduces the number of lists and EPGs loaded simultaneously
3. Results in lower memory consumption but fewer available channels

## FFmpeg Preprocessing Options

Advanced users can adjust FFmpeg behavior:

1. Go to **Options** > **Advanced** > **Playback**.
2. Set **Use FFmpeg Preprocessing** to:
   - **No**
   - **Auto**
   - **Always**
   - **MPEGTS Only**

This affects how the player handles different types of streams.

## Additional Performance Settings

### Buffer Settings
- **Small Buffer**: Faster start, more buffering
- **Large Buffer**: Slower start, smoother playback
- **Auto**: Automatically adjusts based on connection

### Hardware Acceleration
- **Enable**: Uses GPU for video decoding (recommended)
- **Disable**: Uses CPU only (for compatibility)

### Memory Management
- **Low Memory Mode**: Reduces memory usage by loading fewer lists/EPGs
- **Cache Size**: Adjust how much content is cached

## Disk Cache Configuration

### Enabling Disk Cache
1. Go to **Options** > **Advanced** > **Developer options**
2. Enable **Enable disk cache**
3. Set cache limit (default: 1GB)

### Cache Management
- **Automatic cleanup**: Old cache files are automatically removed
- **Manual cleanup**: Clear cache in Options > Advanced > Developer options
- **Cache location**: Stored locally on your device

## Memory Usage Optimization

### Typical Memory Usage
- **Normal mode**: Varies based on number of loaded lists
- **Low-end mode**: Reduced memory consumption
- **Cache usage**: Additional memory for disk cache

### Reducing Memory Usage
1. **Enable low-end device mode**
2. **Reduce number of loaded lists**
3. **Clear cache regularly**
4. **Close other applications**

## CPU Usage During Playback

### Normal Operation
- **Typical usage**: Normal CPU consumption during playback
- **Hardware acceleration**: Reduces CPU usage when enabled
- **Background processes**: Minimal CPU usage when not actively streaming

### Optimization Tips
- **Enable hardware acceleration** when possible
- **Close unnecessary applications**
- **Use low-end mode** on older devices

## Platform-Specific Optimizations

### Windows
- **DirectX acceleration**: Automatically enabled
- **Memory management**: Windows handles memory allocation
- **Background processes**: Minimal impact on performance

### Android
- **Hardware acceleration**: Uses device GPU
- **Memory management**: Android system manages memory
- **Battery optimization**: May affect background operation

### Linux
- **OpenGL acceleration**: Uses system graphics drivers
- **Memory management**: Linux kernel handles allocation
- **Process isolation**: Limited to two worker processes for EPG and MPEG-TS

## Troubleshooting Performance Issues

If you experience lag or buffering:

1. Enable **Low-end Device Mode**
2. Reduce buffer size in advanced settings
3. Disable hardware acceleration if causing issues
4. Check your internet connection speed (minimum 200KBps)
5. Try switching to a different transmission source
6. Clear cache and restart the app

### Performance Monitoring

### Debug Information
- **Windows/Linux**: Run `megacubo-debug.(sh|cmd)` for detailed logs
- **Developer options**: Enable in Options > Advanced > Developer options
- **Memory usage**: Monitor through system task manager

### Common Performance Issues
- **High memory usage**: Enable low-end mode or reduce loaded lists
- **Buffering**: Check network speed and try different transmissions
- **Slow startup**: Clear cache and restart app
- **Lag during playback**: Enable performance mode or reduce quality

---

*These settings can significantly impact performance. Start with default settings and adjust based on your device capabilities and network conditions.*