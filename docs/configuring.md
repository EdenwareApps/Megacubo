---
title: "Configure Megacubo IPTV Player Settings & Preferences"
description: "Complete guide to customizing Megacubo IPTV player settings, streaming preferences, interface options, and advanced configuration features"
keywords: "IPTV player settings, Megacubo configuration, IPTV app preferences, streaming player customization, IPTV player options, TV streaming settings"
---

<!-- docs/configuring.md -->

[🏠](/README.md) > [User Guide](introduction.md) > Configuring

### IPTV Player Settings & Configuration
<br />

You can customize the application's settings at any time by navigating to the **Options** section. Here, you'll find a variety of preferences designed to enhance your overall experience.

Additionally, you have the option to export your current settings as a JSON file. To do this, go to **Options > Export | Import > Export Settings**. A ZIP file containing `config.json` will be saved to your device.

To import settings back into the application, navigate to **Options > Export | Import > Import Settings** and select a ZIP or JSON file.

To learn more about the app's default [hotkeys](hotkeys.md) or [user interface](ui-overview.md).

**Note:** Some settings may require you to restart the application for changes to take effect.

**Note²:** You can create and import/export themes in a similar manner, found under **Tools > Themes**.

<br />

#### General Settings

- **allow-edit-channel-list**: `true`  
  *Allows users to edit the channel list.*

- **animate-background**: `slow-desktop`  
  *Sets the background animation speed for desktop.*

- **auto-test**: `false`  
  *Enables or disables automatic testing.*

- **autocrop-logos**: `true`  
  *Automatically crops logos to fit the UI.*

- **background-color**: `#110B24`  
  *Defines the background color of the application.*

- **background-transparency**: `65`  
  *Sets the transparency level of the background color revealing the background image or video.*

- **bookmarks-desktop-icons**: `true`  
  *Enables desktop icons for bookmarks.*

- **broadcast-start-timeout**: `40`  
  *Timeout in seconds for starting a broadcast.*

- **channels-list-smart-sorting**: `0`  
  *Determines the smart sorting behavior of the channel list.*

- **communitary-mode-lists-amount**: `0`  
  *Sets the number of lists accepted and loaded shared from users in the same region.*

- **connect-timeout**: `10`  
  *Timeout in seconds for establishing a connection.*

- **countries**: `[]`  
  *List of countries of interest for the user.*

- **enable-console**: `false`  
  *Enables or disables the console for debugging.*

- **epg**: `""`  
  *Sets the Electronic Program Guide URLs. May be an array.*


#### FFmpeg Settings

- **ffmpeg-broadcast-pre-processing**: `auto`  
  *Defines the pre-processing behavior for broadcasts using FFmpeg.*

- **ffmpeg-crf**: `18`  
  *Sets the Constant Rate Factor for video quality in FFmpeg.*


#### Font Settings

- **font-color**: `#FFFFFF`  
  *Defines the font color used in the UI.*

- **font-family**: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;`  
  *Sets the font family used in the UI.*

- **font-size**: `3`  
  *Specifies the font size for the UI.*


#### GPU Settings

- **fx-nav-intensity**: `2`  
  *Controls the intensity of visual effects during navigation.*

- **gpu**: `true`  
  *Enables or disables GPU acceleration.*


#### UI Settings

- **hide-back-button**: `false`  
  *Determines whether to show or hide the back button.*

- **hls-prefetching**: `true`  
  *Enables HLS prefetching for smoother streaming.*

- **home-recommendations**: `2`  
  *Number of recommendation pages shown on the home screen.*

- **in-disk-caching-size**: `1024`  
  *Sets the maximum disk caching size in MB.*

- **kids-fun-titles**: `true`  
  *Displays fun titles for kids' content.*

- **lists**: `[]`  
  *Stores user-defined list URLs or paths.*

- **lists-loader-concurrency**: `6`  
  *Sets the concurrency level for loading lists.*

- **live-window-time**: `180`  
  *Time in seconds for live window retention.*

- **live-stream-fmt**: `auto`  
  *Sets the format for live streams.*

- **locale**: `""`  
  *Defines the application locale for language settings.*

- **miniplayer-auto**: `true`  
  *Enables the automatic display of the mini player when minimized.*

- **only-known-channels-in-trending**: `true`  
  *Shows only trending channels that are known.*

- **osd-speak**: `false`  
  *Enables or disables on-screen display speech.*

- **parental-control**: `remove`  
  *Defines parental control behavior, defaulting to **remove** adult content from view.*

- **parental-control-terms**: `"."`  
  *Terms used for parental control checks.*

- **public-lists**: `yes`  
  *Specifies if public channel lists are accepted.*

- **play-while-loading**: `true`  
  *Allows playback to continue while loading another stream.*

- **playback-rate-control**: `true`  
  *Enables automatic control over playback rate to keep up with stream buffer.*

- **preferred-ip-version**: `0`  
  *Sets the preferred IP version for network connections.*

- **resume**: `false`  
  *Enables or disables resuming playback from the player stream on app startup.*

- **stretch-logos**: `false`  
  *Determines whether to stretch logos for display.*

- **search-missing-logos**: `true`  
  *Enables automatic searching for missing logos.*

- **show-logos**: `true`  
  *Shows channel logos and thumbnails in the UI.*

- **popular-searches-in-trending**: `true`  
  *Displays popular searches in trending content.*

- **startup-window**: `""`  
  *Specifies the startup window mode to display.*

- **status-flags-type**: `false`  
  *Controls whether to show the stream type of tested streams.*

- **subtitles**: `true`  
  *Enables or disables subtitle support.*

- **timeout-secs-energy-saving**: `60`  
  *Timeout in seconds for entering energy-saving mode when not playing.*

- **transcoding**: `true`  
  *Enables transcoding for media formats.*

- **transcoding-resolution**: `720p`  
  *Sets the resolution for transcoded media.*

- **mpegts-packet-filter-policy**: `1`  
  *Sets the filtering policy for MPEG-TS packets.*

- **mpegts-persistent-connections**: `true`  
  *Enables persistent connections for MPEG-TS streaming.*

- **mpegts-use-worker**: `true`  
  *Enables the use of workers for MPEG-TS processing.*

- **read-timeout**: `30`  
  *Timeout in seconds for reading data over HTTP and HTTPS.*

- **tune-concurrency**: `8`  
  *Sets the concurrency level for tuning operations.*

- **tune-ffmpeg-concurrency**: `3`  
  *Sets the concurrency level for FFmpeg on tuning operations.*

- **tuning-blind-trust**: `"live,video"`  
  *Defines trusted stream types, skipping initial testing on tuning.*

- **tuning-icon**: `"fas fa-sync-alt"`  
  *Specifies the icon used for tuning operations.*

- **uppercase-menu**: `false`  
  *Determines whether the menu is displayed in uppercase.*

- **use-keepalive**: `true`  
  *Enables keep-alive for network connections.*

- **user-agent**: `"VLC/3.0.8 LibVLC/3.0.8"`  
  *Sets the user agent for network requests.*


#### Display Sizes

- **view-size**:
  - **landscape**: `{ "x": 4, "y": 3 }`  
    *Sets the landscape display grid size.*
  
  - **portrait**: `{ "x": 1, "y": 8 }`  
    *Sets the portrait display grid size.*


#### Volume Settings

- **volume**: `100`  
  *Defines the default volume level.*

- **watch-now-auto**: `auto`  
  *Sets the behavior for the "Watch Now" prompt.*

- **ui-sounds**: `true`  
  *Enables UI sounds for user interactions.*

- **unpause-jumpback**: `5`  
  *Time in seconds to jump back when unpausing.*

- **use-local-time-counter**: `false`
  *Determines whether to use a local time counter.*

## See Also

- **[Hotkeys](hotkeys.md)** - Keyboard shortcuts and controls
- **[UI Overview](ui-overview.md)** - Understanding the interface
- **[Troubleshooting](troubleshooting.md)** - Common issues and solutions

---

[🏠](/README.md) | [User Guide](introduction.md) | [Hotkeys](hotkeys.md)
