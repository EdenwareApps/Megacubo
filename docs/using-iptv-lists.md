<!-- docs/using-iptv-lists.md -->

# <span style="color: #2e86de;">Using IPTV Lists</span>

## Understanding M3U Files

M3U files are plain text playlists containing links to live TV streams. They look like this:

```
#EXTM3U
#EXTINF:-1 tvg-id="br.sbt" tvg-name="SBT" tvg-logo="sbt.png",SBT
http://stream.example.com/sbt.m3u8
```

You can get M3U files from providers, online communities, or create your own.

## Adding a New IPTV List

1. Go to **My Lists** > **Add List**.
2. Enter the URL or local path to your M3U file.
3. Click **OK** to import.

The app will parse the list and display all available channels.

### Sharing Lists in Community Mode

When adding a list, if the app doesn't detect username and password in the URL, it will ask if you want to share the list with the community. 

**Benefits of sharing:**
- Helps other users discover new content
- Contributes to the community pool of available channels

**Considerations:**
- May cause access restrictions if your list doesn't allow simultaneous connections
- Shared lists are anonymous and don't reveal your personal information
- You can disable sharing at any time

> **Note**: For detailed information about Community Mode, see [Community Mode](community-mode.md).

## Editing or Removing Existing Lists

1. Go to **My Lists**.
2. Long press or right-click a list.
3. Choose **Rename**, **Reload**, or **Remove**.

## Managing EPG Files

Electronic Program Guide (EPG) files provide TV schedules in XML format.

To associate an EPG file:

1. While editing a list, click **Associate Program Guide**.
2. Choose the corresponding `.xml` file.
3. The program guide will appear under each channel's **Program Guide** option.

## List Management Features

### Organizing Lists
- **Rename lists** for better organization
- **Reorder lists** by dragging and dropping
- **Group lists** by category or region
- **Search within lists** for specific channels

### List Information
- **Channel count** displayed for each list
- **Last update** timestamp
- **Status indicators** (active, broken, updating)
- **Quality metrics** for list reliability

## Advanced List Options

### Backup and Restore
- **Export lists** to backup your configuration
- **Import lists** from backup files
- **Sync across devices** (Premium feature)

### Quality Control
- **Test channels** before adding to favorites
- **Report broken links** to help improve lists
- **Filter channels** by quality or region

## Creating Custom Lists

### Manual Creation
1. Create a text file with `.m3u` extension
2. Add channel entries following M3U format
3. Save and import into Megacubo

### List Format Requirements
- **Header**: Must start with `#EXTM3U`
- **Channel info**: Use `#EXTINF` format
- **Stream URL**: Direct link to video stream
- **Encoding**: UTF-8 recommended

> **Note**: For detailed information about Community Mode integration, see [Community Mode](community-mode.md).

## Troubleshooting List Issues

### Common Problems
- **Invalid format**: Check M3U syntax
- **Broken links**: Verify stream URLs
- **Encoding issues**: Ensure UTF-8 encoding
- **Access denied**: Check URL accessibility
- **Sharing restrictions**: Lists may not allow community sharing

### Solutions
1. **Validate M3U format** using online tools
2. **Test URLs** in a web browser
3. **Check file encoding** in text editor
4. **Contact list provider** for support
5. **Disable sharing** if causing access issues

### URL Validation
The app automatically validates stream URLs to ensure they're accessible and properly formatted.

---

*Proper list management ensures the best viewing experience. Regularly update your lists and report issues to help maintain quality.*