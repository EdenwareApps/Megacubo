
if(typeof(PremiumHelper) == 'undefined'){
    var PremiumHelper = (() => {
        var self = {
            shouldInstall: false
        }
        self.entry = () => {
            let lic = applyFilters('appLicense', 'free'), nam = Lang.ENABLE_PREMIUM_FEATURES, lbl = ''
            if(lic.indexOf('sponsor') != -1){
                nam = Lang.PREMIUM_IDLE_RESOURCES
            } else if(lic.indexOf('license') != -1) {
                nam = Lang.LICENSE_KEY
                lbl = Lang.PREMIUM_MODE
            }
            var entry = {
                name: nam,
                class: 'entry-premium',
                label: '<i class="fas fa-rocket"></i> '+lbl,
                type: 'check',
                checked: (data) => {
                    return self.loaded(true)
                },
                check: (checked, data, element) => {                 
                    var shouldRestart = false
                    console.warn('CHECKK', checked, data)
                    if(checked){
                        if(Config.get('premium-disabled') != false){
                            Config.set('premium-disabled', false)
                            if(!self.loaded()){
                                self.lockEntry()
                                if(self.available()){                            
                                    self.notification.update(Lang.ENABLING_PREMIUM_FEATURES.format(99), 'fa-mega spin-x-alt', 'forever')
                                    addAction('premiumCommit', () => {
                                        self.notification.update(Lang.WELCOME, 'fa-check-circle', 'normal')
                                        Menu.refresh()
                                    })
                                    premiumStart.call(global)
                                } else if(!self.shouldInstall) {
                                    self.installProcess(element)
                                }
                            }
                        }
                    } else {
                        if(Config.get('premium-disabled') != process.execPath){
                            if(confirm(Lang.USE_FREE_MODE_CONFIRM)){
                                self.lockEntry()
                                self.disable()  
                            } else {  
                                Menu.refresh()  
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
        self.lockEntry = () => {
            let e = document.querySelector('.entry-premium')
            if(e){
                e.className += ' entry-disable'
            }
        }
        self.disable = () => {
            console.warn("PREMIUM HELPER DISABLE")
            if(self.loaded() && closeApp != restartApp){
                let closeAllowed = false
                const restart = restartApp
                premiumStart = askForLicense = closeApp = restartApp = () => {
                    if(closeAllowed){
                        restart()
                    }
                }
                self.shouldInstall = false
                Config.set('premium-disabled', process.execPath)
                premiumReset(() => {
                    console.warn("PREMIUM HELPER DISABLE RESTART", restart)                    
                    closeAllowed = true
                    restart()
                })
            }
        }
        self.installed = () => {
            let lum = '../net_updater'+ (process.arch == 'ia32' ? '32' : '64') +'.exe'
            return fs.existsSync(path.resolve('addons/premium/premium.bin')) && fs.existsSync(path.resolve(lum))
        }
        self.available = () => {
            return (typeof(premiumStart) != 'undefined' && premiumStart)
        }
        self.loaded = () => {
            return (typeof(premiumAddonsLoaded) != 'undefined' && premiumAddonsLoaded)
        }
        self.install = (cb, element) => {
            if(typeof(cb) != 'function'){
                cb = () => {}
            }
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
                        console.log('INSTALL PREMIUM', self.shouldInstall)
                        if(self.shouldInstall){
                           untar(file, process.cwd().replaceAll(path.sep + 'package.nw', ''), (result) => {
                                let ld = self.installed(false)    
                                console.log('INSTALL PREMIUM', result, ld)
                                if(ld){
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
                req.on('data', (chunk) => {
                    if(!self.shouldInstall){
                        self.notification.hide()
                        req.abort()
                    }
                    received_bytes += chunk.length;
                    console.log('INSTALL PREMIUM', 'DOWNLOAD', 'STATUS',  received_bytes, '/', total_bytes)
                    var p = '0'
                    if(total_bytes){
                        p = Math.round(received_bytes / (total_bytes / 100))
                    }
                    self.notification.update(Lang.ENABLING_PREMIUM_FEATURES.format(p), 'fa-mega spin-x-alt', 'forever')
                    jQuery(element).find('.entry-name').html('<i class="fas fa-circle-notch pulse-spin"></i> &nbsp;' + Lang.ENABLING_PREMIUM_FEATURES.format(p))
                })
            }
        }
        self.installProcess = (element) => {
            self.shouldInstall = true
            self.notification.update(Lang.ENABLING_PREMIUM_FEATURES.format(0), 'fa-mega spin-x-alt', 'forever')
            if(element){
                jQuery(element).find('.entry-name').html('<i class="fas fa-circle-notch pulse-spin"></i> &nbsp;' + Lang.ENABLING_PREMIUM_FEATURES.format(0))
            }
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
            }, element)
        }
        self.notification = notify('...', 'fa-rocket', 'forever')
        self.notification.hide()
        addFilter('optionsEntries', (entries) => {
            entries.splice(entries.length - 1, 0, self.entry())
            return entries
        })
        addFilter('afterToolsEntries', (entries) => {
            var ns = applyFilters('premiumEntries', [])
            if(ns && ns.length){
                entries = entries.concat(ns)
            }
            return entries
        })
        return self
    })()
}