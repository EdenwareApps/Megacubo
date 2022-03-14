# Megacubo
<p align="center">
  <img src="https://static.megacubo.tv/wp-content/uploads/2022/03/cropped-default_icon-192x192.png" alt="Megacubo logo" title="Megacubo logo" />
</p>

Megacubo is an intuitive, multi-language and cross-platform IPTV player with support for history, bookmarks and much more.

You can add as many IPTV lists you want (M3U format) and with Miniplayer mode, you can work or navigate on your PC while watching any broadcast.

Platforms: Windows, Linux, MacOS and Android.

Available languages: English, Spanish, Portuguese and Italian. You can help us adding [more languages](https://github.com/efoxbr/megacubo/tree/master/www/nodejs-project/lang)?

<br/>

# Releases
Want to use the software, go to [our releases folder](https://github.com/efoxbr/megacubo/releases) to get it.

<br/>

<p align="center">
  <img src="https://static.megacubo.tv/files/screenshot-en-680.jpg" alt="Megacubo UI screenshot" title="Megacubo UI screenshot" />
</p>

<br/>

# Development setup

### With Cordova:
```
git clone https://github.com/efoxbr/megacubo.git
# ffmpeg binary not needed, it will install and use mobile-ffmpeg lib
cd megacubo
npm --prefix ./www/nodejs-project install ./www/nodejs-project
cordova prepare
```
After that, edit the file build-extras.gradle to choose the target ABIs.

### With NW.js (>=0.37.4):
```
git clone https://github.com/efoxbr/megacubo.git
# put ffmpeg binary at ./megacubo/www/nodejs-project/ffmpeg/ (named as ffmpeg or ffmpeg.exe)
cd megacubo
npm --prefix ./www/nodejs-project install ./www/nodejs-project
nw --nwapp=www/nodejs-project
```

Any errors along the way? [Let us know](https://github.com/efoxbr/megacubo/issues).

<br/>

# Contributing

Please, feel free to contribute to the project by opening a discussion under Issues section or sending your PR.

You can help us by [improving translations](https://github.com/efoxbr/megacubo/tree/master/www/nodejs-project/lang) and the [known channel names list](https://github.com/efoxbr/world-tv-channels).
