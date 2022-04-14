
# Development setup.

### With NW.js (for desktop):
Easier and recommended way. [NW.js installed version](https://subscription.packtpub.com/book/web-development/9781785280863/1/ch01lvl1sec10/downloading-and-installing-nw-js) should be >= 0.37.4.
```
git clone https://github.com/efoxbr/megacubo.git
# put ffmpeg binary at ./megacubo/www/nodejs-project/ffmpeg/ (named as ffmpeg or ffmpeg.exe)
cd megacubo
npm --prefix ./www/nodejs-project install ./www/nodejs-project
nw --nwapp=www/nodejs-project
```

### With Cordova (for Android):
```
git clone https://github.com/efoxbr/megacubo.git
# ffmpeg binary not needed, it will install and use mobile-ffmpeg lib
cd megacubo
npm --prefix ./www/nodejs-project install ./www/nodejs-project
cordova prepare
```
After that, edit the file build-extras.gradle to choose the target ABIs. 

If you are in doubt, go with NW.js, as for Cordova it's tricky to set project up and running.

Any errors along the way? [Let us know](https://github.com/efoxbr/megacubo/issues).
