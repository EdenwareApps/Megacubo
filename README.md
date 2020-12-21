# Megacubo
A intuitive, multi-language and cross-platform IPTV player.

Platforms: Windows, Linux, MacOS and Android.
   
   
   
# Releases
Want to use the software, go to [our releases folder](https://github.com/efoxbr/megacubo/releases) to get it.
   
   
   
# Development

### With Cordova:
```
git clone https://github.com/efoxbr/megacubo.git
cd megacubo
cordova prepare
```
After that, edit the file build-extras.gradle to choose the target ABIs.

### With NW.js (>=0.37.4):
```
git clone https://github.com/efoxbr/megacubo.git
cd megacubo
nw --nwapp=www/nodejs-project
```

### With browser + node (>= 11.14.0):
```
git clone https://github.com/efoxbr/megacubo.git
cd megacubo/www/nodejs-project
node --inspect main.js
```
...now open your browser at http://localhost:5000/

Any errors along the way? Let us know.
