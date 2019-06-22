
if(typeof(PremiumHelper) == 'undefined'){
    var PremiumHelper = (() => {
        var self = {
            shouldInstall: false
        }
        self.entry = () => {
            var entry = {
                name: Lang.ENABLE_PREMIUM_FEATURES,
                class: 'entry-premium',
                label: '<i class="fas fa-rocket"></i>',
                type: 'check',
                checked: (data) => {
                    return self.installed(true)
                },
                check: (checked, data, element) => {
                    console.warn('CHECKK', checked, data)
                    if(checked){
                        if(!self.installed(true)){
                            self.shouldInstall = true;
                            self.notification.update(Lang.ENABLING_PREMIUM_FEATURES.format(0), 'fa-circle-notch pulse-spin', 'forever')
                            jQuery(element).find('.entry-name').html('<i class="fas fa-circle-notch pulse-spin"></i> &nbsp;' + Lang.ENABLING_PREMIUM_FEATURES.format(0))
                            self.install((err) => {
                                self.notification.hide()
                                if(!self.installed(false)){
                                    console.error(err)
                                    Menu.refresh()                                    
                                    self.notification.update(Lang.ENABLE_PREMIUM_FEATURES_FAILURE, 'fa-exclamation-circle faclr-red', 'normal')
                                    setTimeout(() => {
                                        if(!isFullScreen()){
                                            nw.Shell.openExternal(appDownloadUrl())
                                        }
                                    }, notifyParseTime('normal') * 1000)
                                } else {
                                    restartApp(true)
                                }
                            })
                        }
                    } else {
                        self.shouldInstall = false;
                        if(self.installed(true)){
                            var ok = false;
                            if(typeof(premiumReset) == 'function'){
                                premiumReset()
                                askForLicense()
                                ok = true
                                Menu.refresh()
                            }
                            if(!ok){
                                self.notification.update(Lang.PROCESSING, 'fa-circle-notch pulse-spin', 'forever')
                                jQuery(element).find('.entry-name').html('<i class="fas fa-circle-notch pulse-spin"></i> &nbsp;' + Lang.PROCESSING)
                                self.uninstall((ret) => {
                                    self.notification.hide()
                                    Menu.refresh()
                                    if(ret){
                                        restartApp(false)
                                    }
                                })
                            }
                        }                        
                    }
                },
                callback: () => {
                    Menu.refresh()
                }
            }
            return entry
        }
        self.installed = (deep) => {
            if(!deep && (
                !fs.existsSync(path.resolve('addons/premium/premium.bin')) &&
                !fs.existsSync(path.resolve('addons/premium/premium.js'))
            )){
                return false;
            }
            return !deep || (typeof(premiumAddonsLoaded) != 'undefined' && premiumAddonsLoaded)
        }
        self.install = (cb) => {
            if(!self.installed(true) && !applyFilters('installPremium')){
                self.shouldInstall = true;
                var tmp = Store.folder, endpoint = 'http://megacubo.tv/bin/premium/{0}/premium_{1}-{2}.tar.gz'.format(nw.App.manifest.version, process.platform, process.arch), file = tmp + path.sep + basename(endpoint)
                console.log('INSTALL PREMIUM', 'DOWNLOAD', endpoint, file)
                var received_bytes = 0, total_bytes = 0;
                var req = request({
                    method: 'GET',
                    uri: endpoint,
                    ttl: 0
                }, (error, response, body) => {
                    console.log('INSTALL PREMIUM', 'DOWNLOAD', "FINISHED", file, error)
                    if(error){
                        cb(error || 'Download failure')
                    } else {
                        if(self.shouldInstall){
                           untar(file, process.cwd().replaceAll(path.sep + 'package.nw', ''), (result) => {
                                if(self.installed(false)){
                                    doAction('installPremiumSuccess')
                                    console.log('INSTALL PREMIUM', 'EXTRACTED', file)
                                    cb(null)
                                } else {
                                    cb('Extract error.', result)
                                }
                           }, () => {
                                return self.installed(false)
                           })
                        }
                    }
                })
                req.pipe(fs.createWriteStream(file))
                req.on('response', function ( data ) {
                    total_bytes = parseInt(data.headers['content-length' ])
                    console.log('INSTALL PREMIUM', 'DOWNLOAD', 'STATUS',  received_bytes, '/', total_bytes)
                })
                req.on('data', function(chunk) {
                    if(!self.shouldInstall){
                        self.notification.hide()
                        req.abort()
                    }
                    received_bytes += chunk.length;
                    console.log('INSTALL PREMIUM', 'DOWNLOAD', 'STATUS',  received_bytes, '/', total_bytes)
                    var p = '0';
                    if(total_bytes){
                        p = Math.round(received_bytes / (total_bytes / 100))
                    }
                    self.notification.update(Lang.ENABLING_PREMIUM_FEATURES.format(p), 'fa-circle-notch pulse-spin', 'forever')
                })
            }
        }
        self.uninstall = (cb, force) => {
            if(force === true || applyFilters('uninstallPremium') === true){
                Config.set('license-key', '')
                if(typeof(cb) != 'function'){
                    cb = () => {
                        restartApp(true)
                    }
                }
                removeFolder(path.resolve('addons/premium'), true, () => {
                    cb(true)
                })
                return true;
            } else if(typeof(cb)=='function'){
                cb(false)
            }
        }
        self.notification = notify('...', 'fa-rocket', 'forever')
        self.notification.hide()
        addFilter('afterToolsEntries', (entries) => {
            var ns = applyFilters('premiumEntries', [self.entry()])
            if(ns && ns.length){
                entries = entries.concat(ns)
            }
            return entries;
        })
        return self;
    })()
}