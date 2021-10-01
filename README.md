# Megacubo
A intuitive, multi-language and cross-platform IPTV player.

Platforms: Windows, Linux, MacOS and Android.

Available languages: English, Spanish, Portuguese and Italian. You can help us adding [more languages](https://github.com/efoxbr/megacubo/tree/master/www/nodejs-project/lang)?

<br/>

# Releases
Want to use the software, go to [our releases folder](https://github.com/efoxbr/megacubo/releases) to get it.

<br/>

![Megacubo UI screenshot](https://megacubo.tv/files/screenshot-en.jpg) 

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
