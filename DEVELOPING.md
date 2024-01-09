
# Development setup.

### With Electron (for desktop):
Easier and recommended way.
```
git clone https://github.com/EdenwareApps/Megacubo.git
cd Megacubo
npm ci
npm start
```

### Install globally with NPM (for desktop):
```
npm i -g megacubo
npx megacubo
```

### With Cordova (for Android):
```
git clone https://github.com/EdenwareApps/Megacubo.git
cd Megacubo
npm ci
cordova prepare
```
After that, edit the file build-extras.gradle to choose the target ABIs. 

If you are in doubt, go with Electron, as for Cordova it's tricky to set project up and running.

Any errors along the way? [Let us know](https://github.com/EdenwareApps/Megacubo/issues).
