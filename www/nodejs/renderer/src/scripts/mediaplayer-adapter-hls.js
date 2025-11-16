import { MediaPlayerAdapterHTML5Video } from './mediaplayer-adapter'

const { ErrorTypes, ErrorDetails, Events } = Hls

class MediaPlayerAdapterHTML5HLS extends MediaPlayerAdapterHTML5Video {
        constructor(container) {
                super(container)
                this.currentSrc = ''
                this.fatalErrorsCount = 0
                this.lastFatalErrorTime = 0
                this.isReloading = false
                this.isSkippingSegment = false
                
                // Monitoramento de progresso
                this.lastProgressTime = 0
                this.lastProgressValue = 0
                this.progressCheckInterval = null
                this.startMonitoringTimeout = null
                this.skipSegmentTimeout = null
                this.bufferStallCount = 0
                this.lastBufferStallTime = 0
                this.lastManifestUpdate = 0
                this.lastFragmentLoad = 0
                
                this.setup('video')
        }
        load(src, mimetype, additionalSubtitles, cookie, mediatype) {
                if (!src) {
                        console.error('Bad source', src, mimetype)
                        return
                }
                this.active = true
                // Reset fatal errors count on new load if enough time has passed or source changed                                                             
                const currentTime = this.time()
                const srcChanged = src !== this.currentSrc
                if (currentTime != this.lastFatalErrorTime || srcChanged) {
                        this.fatalErrorsCount = 0
                }

                // CRITICAL: Destroy existing HLS instance before creating a new one to prevent memory leaks
                if (this.hls) {
                        console.warn('HLS instance already exists, destroying before creating new one')
                        try {
                                // Remover todos os event listeners antes de destroy
                                this.hls.off(Events.ERROR)
                                this.hls.off(Events.FRAG_LOADED)
                                this.hls.off(Events.FRAG_LOADING)
                                this.hls.off(Events.MANIFEST_PARSED)
                                this.hls.off(Events.LEVEL_UPDATED)
                                this.hls.destroy()
                        } catch (e) {
                                console.error('Error destroying previous HLS instance:', e)
                        }
                        this.hls = null
                }

                this.setVars(src, mimetype, additionalSubtitles, cookie, mediatype)
                const timeout = 15000
                const config = {
                        enableWorker: true,
                        liveDurationInfinity: false,
                        lowLatencyMode: true,
                        backBufferLength: 0,
                        fragLoadingTimeOut: timeout,
                        fragLoadingMaxRetry: 1,
                        levelLoadingMaxRetry: 2,
                        manifestLoadingMaxRetry: 20,
                        fragLoadingMaxRetryTimeout: timeout,
                        levelLoadingMaxRetryTimeout: timeout,
                        manifestLoadingMaxRetryTimeout: timeout
                }
                const hls = new Hls(config)
                this.setTextTracks(this.object, additionalSubtitles)
                hls.loadSource(this.currentSrc)
                hls.attachMedia(this.object)
                hls.on(Events.ERROR, (event, data) => {
                        console.error('HLS ERROR', data)
                        if (!data) data = event
                        if (!data) return

                        // Prevent concurrent operations that could cause memory leaks
                        // Mas permitir erros críticos mesmo durante operações
                        if (this.isReloading || this.isSkippingSegment) {
                                // Apenas ignorar erros não-fatais durante operações
                                if (!data.fatal && data.details !== 'bufferStalledError') {
                                        console.warn('HLS operation already in progress, ignoring non-critical error', this.isReloading, this.isSkippingSegment)
                                        return
                                }
                                // Erros fatais ou bufferStalledError devem ser processados mesmo durante operações
                        }

                        if (data.details && data.frag && !data.fatal) {
                                if (data.details === 'bufferStalledError') {
                                        const now = Date.now()
                                        if (now - this.lastBufferStallTime < 5000) {
                                                this.bufferStallCount++
                                        } else {
                                                this.bufferStallCount = 1
                                        }
                                        this.lastBufferStallTime = now
                                        
                                        // Se muitos stalls consecutivos em pouco tempo, tratar como fatal
                                        if (this.bufferStallCount >= 5) {
                                                console.error('HLS: Too many buffer stalls (', this.bufferStallCount, '), treating as fatal')
                                                this.emit('error', 'Buffer stalling repeatedly', true)
                                                this.setState('')
                                                this.bufferStallCount = 0
                                                return
                                        }
                                        
                                        // Tentar skip segment
                                        return this.skipSegment(data.frag)
                                }
                                
                                if (data.details === 'fragParsingError' && data.error && data.error.message && data.error.message.includes('Found no media')) {
                                        // Fragmento vazio - pular imediatamente sem retry
                                        console.warn('Empty fragment detected, skipping immediately', data.frag.url)
                                        return this.skipSegment(data.frag)
                                }
                                
                                if (['fragParsingError', 'fragLoadError', 'bufferNudgeOnStall'].includes(data.details)) {
                                        // handle fragment load errors
                                        return this.skipSegment(data.frag)
                                }
                        } else if (data.fatal) {
                                const currentTime = this.time()
                                if (currentTime != this.lastFatalErrorTime) {
                                        this.fatalErrorsCount = 0
                                }
                                this.fatalErrorsCount++
                                this.lastFatalErrorTime = currentTime

                                // Limit reload attempts: 3 for initial errors, 5 for live streams, 10 for VOD
                                // Reduced from 20 to prevent OOM issues with live streams                                      
                                const isLive = this.mediatype === 'live'
                                const maxRetries = currentTime > 0 ? (isLive ? 5 : 10) : 3

                                if (this.fatalErrorsCount >= maxRetries) {
                                        console.error('HLS fatal error: max retries reached', this.fatalErrorsCount, data.type, 'isLive:', isLive)
                                        this.emit('error', 'HLS fatal error: max retries reached', true)
                                        this.setState('')
                                        return
                                }

                                // Tratar levelParsingError com media sequence mismatch de forma especial
                                // Este erro indica que o servidor reiniciou a sequência - não tentar skipSegment
                                if (data.details === 'levelParsingError' && data.error && 
                                    data.error.message && data.error.message.includes('media sequence mismatch')) {
                                        console.error('HLS: Media sequence mismatch detected - server reset, doing full reload')
                                        const sequenceMismatchCount = this.fatalErrorsCount
                                        this.isReloading = true
                                        this.reload(() => {
                                                this.fatalErrorsCount = sequenceMismatchCount
                                                this.isReloading = false
                                        })
                                        return
                                }

                                // Tratar bufferAppendError de forma menos agressiva
                                // Buffer append errors são geralmente transitórios - não fazer reload fatal imediatamente
                                if (data.details === 'bufferAppendError') {
                                        // Apenas tentar skip segment se houver fragmento e não for fatal
                                        if (data.frag && !data.fatal && !this.isSkippingSegment && !this.isReloading) {
                                                console.warn('HLS: bufferAppendError non-fatal - attempting skip segment')
                                                return this.skipSegment(data.frag)
                                        }
                                        
                                        // Se for fatal ou não houver fragmento, tratar através do switch abaixo
                                        // (não retornar aqui, deixar continuar para o switch tratar como MEDIA_ERROR)
                                        if (data.fatal) {
                                                console.warn('HLS: bufferAppendError fatal - will be handled by switch', { 
                                                        hasFrag: !!data.frag, 
                                                        isSkipping: this.isSkippingSegment, 
                                                        isReloading: this.isReloading 
                                                })
                                                // Não retornar - deixar continuar para o switch tratar
                                        } else {
                                                // Se não for fatal e não tem frag, apenas ignorar
                                                console.warn('HLS: bufferAppendError non-fatal without frag - ignored')
                                                return
                                        }
                                }

                                switch (data.type) {
                                        case ErrorTypes.MEDIA_ERROR:
                                                console.error('HLS fatal media error encountered, reload', this.fatalErrorsCount, '/', maxRetries)
                                                const mediaErrorsCount = this.fatalErrorsCount

                                                // Only skip segment if not already reloading and skip is not in progress
                                                if (data.frag && !this.isSkippingSegment && !this.isReloading) {
                                                        // Skip segment asynchronously, then reload after a short delay
                                                        this.skipSegment(data.frag).then(() => {
                                                                // Wait a bit before reload to ensure skip completes
                                                                setTimeout(() => {
                                                                        if (!this.isReloading && this.hls) {
                                                                                this.isReloading = true
                                                                                this.reload(() => {
                                                                                        this.fatalErrorsCount = mediaErrorsCount
                                                                                        this.isReloading = false
                                                                                })
                                                                        }
                                                                }, 200)
                                                        }).catch(() => {
                                                                // If skip fails, proceed with reload anyway
                                                                if (!this.isReloading && this.hls) {
                                                                        this.isReloading = true
                                                                        this.reload(() => {
                                                                                this.fatalErrorsCount = mediaErrorsCount
                                                                                this.isReloading = false
                                                                        })
                                                                }
                                                        })
                                                } else {
                                                        // Skip segment not available or already in progress, just reload
                                                        this.isReloading = true
                                                        this.reload(() => {
                                                                this.fatalErrorsCount = mediaErrorsCount
                                                                this.isReloading = false
                                                        })
                                                }
                                                break
                                        case ErrorTypes.NETWORK_ERROR:
                                                console.error('HLS fatal network error encountered, reload', this.fatalErrorsCount, '/', maxRetries)
                                                const networkErrorsCount = this.fatalErrorsCount
                                                this.isReloading = true
                                                this.reload(() => {
                                                        this.fatalErrorsCount = networkErrorsCount
                                                        this.isReloading = false
                                                })
                                                break
                                        default:
                                                console.error('HLS unknown fatal error encountered, destroy')
                                                this.emit('error', 'HLS fatal error', true)
                                                break
                                }
                        }
                })
                
                // Monitorar eventos HLS para detectar atividade real
                hls.on(Events.FRAG_LOADED, (event, data) => {
                        // Marcar que há atividade de download
                        this.lastFragmentLoad = Date.now()
                        this.bufferStallCount = 0 // Reset stall count on successful load
                })
                
                hls.on(Events.FRAG_LOADING, (event, data) => {
                        // Fragmento começando a carregar
                        this.lastFragmentLoad = Date.now()
                })
                
                hls.on(Events.MANIFEST_PARSED, (event, data) => {
                        // Playlist atualizada
                        this.lastManifestUpdate = Date.now()
                })
                
                hls.on(Events.LEVEL_UPDATED, (event, data) => {
                        // Playlist atualizada (para live streams)
                        this.lastManifestUpdate = Date.now()
                })
                
                this.hls = hls
                this.connect()
                
                // Cancelar timeout anterior se existir
                if (this.startMonitoringTimeout) {
                        clearTimeout(this.startMonitoringTimeout)
                        this.startMonitoringTimeout = null
                }
                
                // Iniciar monitoramento de progresso após um delay
                this.startMonitoringTimeout = setTimeout(() => {
                        this.startMonitoringTimeout = null
                        this.startProgressMonitoring()
                }, 1000) // Aguardar 1s para garantir que HLS iniciou
        }
        skipSegment(frag) {
                // Prevent concurrent skip operations that could cause memory leaks
                if (this.isSkippingSegment || !this.hls) {
                        console.warn('Skip segment already in progress or HLS not available')
                        return Promise.resolve()
                }

                this.isSkippingSegment = true
                return new Promise((resolve, reject) => {
                        let flagClearedInTimeout = false // Rastrear se a flag foi agendada para limpeza no setTimeout
                        try {
                                // Verify HLS instance still exists
                                if (!this.hls) {
                                        console.warn('HLS instance destroyed during skipSegment')
                                        this.isSkippingSegment = false
                                        resolve()
                                        return
                                }

                                const start = frag.start + frag.duration
                                
                                // Validar valores antes de pular
                                if (isNaN(start) || start <= 0 || !isFinite(start)) {
                                        console.warn('Cannot skip segment: invalid timing', { start, fragStart: frag.start, fragDuration: frag.duration })
                                        this.isSkippingSegment = false
                                        resolve()
                                        return
                                }
                                
                                if (frag.loader) {
                                        console.warn('Fix level to ' + start)
                                        frag.loader.abort()
                                        frag.loader.startPosition = start

                                        // Verify HLS instance still exists before triggering
                                        if (this.hls && typeof this.hls.trigger === 'function') {
                                                this.hls.trigger(Events.LEVEL_LOADING, {
                                                        url: frag.url
                                                })
                                                resolve()
                                        } else {
                                                console.warn('HLS instance or trigger method not available')
                                                resolve()
                                        }
                                } else {
                                        const currentTime = this.hls.media ? this.hls.media.currentTime : 0
                                        
                                        // Verificar se a distância do skip é significativa (pelo menos 0.5 segundos)
                                        // Se for muito pequena, não vale a pena fazer skip - pode causar loop
                                        const skipDistance = Math.abs(start - currentTime)
                                        if (skipDistance < 0.5 && currentTime > 0) {
                                                console.warn('HLS: Skip distance too small (', skipDistance.toFixed(3), 's), skipping operation', {
                                                        currentTime: currentTime.toFixed(3),
                                                        targetTime: start.toFixed(3)
                                                })
                                                this.isSkippingSegment = false
                                                resolve()
                                                return
                                        }
                                        
                                        const fixPlayback = this.hls.media && currentTime >= (frag.start - 12) && currentTime < start

                                        // Log fragment info without the object
                                        const fragInfo = frag.url ? `frag: ${frag.url.split('/').pop()}` : 'unknown frag'
                                        console.warn('Skip from ' + (currentTime || 'unknown') + ' to ' + start, fragInfo, fixPlayback)

                                        // Verify HLS instance still exists before operations
                                        if (!this.hls) {
                                                console.warn('HLS instance destroyed during skipSegment operations')
                                                this.isSkippingSegment = false
                                                resolve()
                                                return
                                        }

                                        this.hls.stopLoad()
                                        if (fixPlayback && this.hls.media) {
                                                this.hls.media.currentTime = start
                                        }

                                        // Verify HLS instance still exists before startLoad
                                        if (!this.hls) {
                                                console.warn('HLS instance destroyed before startLoad')
                                                this.isSkippingSegment = false
                                                resolve()
                                                return
                                        }

                                        // NÃO chamar startLoad imediatamente - isso pode causar loop infinito
                                        // Em vez disso, usar um pequeno delay para permitir que o stopLoad complete
                                        // e evitar que o HLS tente recarregar a playlist imediatamente
                                        flagClearedInTimeout = true // Marcar que a flag será limpa no setTimeout
                                        setTimeout(() => {
                                                if (this.hls && !this.isReloading) {
                                                        this.hls.startLoad(start)
                                                }
                                                // Limpar flag após um delay adicional
                                                setTimeout(() => {
                                                        this.isSkippingSegment = false
                                                }, 200)
                                        }, 100)

                                        // Verify HLS instance and media still exist before play
                                        if (fixPlayback && this.hls && this.hls.media) {
                                                // Use play().catch() to handle AbortError gracefully
                                                this.hls.media.play().catch(err => {
                                                        if (err.name !== 'AbortError') {
                                                                console.error('Error playing media after skip:', err)
                                                        }
                                                })
                                        }
                                        // Flag será limpa no setTimeout acima, não limpar no finally
                                        resolve()
                                }
                        } catch (e) {
                                console.error('Error in skipSegment:', e)
                                this.isSkippingSegment = false
                                reject(e)
                        } finally {
                                // Clear flag after a short delay to allow operation to complete
                                // Apenas limpar se não foi agendado no setTimeout acima (caso do frag.loader)
                                // Cancelar timeout anterior se existir
                                if (this.skipSegmentTimeout) {
                                        clearTimeout(this.skipSegmentTimeout)
                                }
                                // Só limpar aqui se não estamos no caminho do else (que já tem setTimeout próprio)
                                // ou se ocorreu erro no caminho do frag.loader
                                if (!flagClearedInTimeout) {
                                        this.skipSegmentTimeout = setTimeout(() => {
                                                this.skipSegmentTimeout = null
                                                this.isSkippingSegment = false
                                        }, 100)
                                }
                        }
                })
        }
        startProgressMonitoring() {
                if (this.progressCheckInterval) return
                
                // Aguardar um pouco mais para garantir que hls está pronto
                if (!this.hls || !this.hls.media) {
                        // Cancelar timeout anterior se existir
                        if (this.startMonitoringTimeout) {
                                clearTimeout(this.startMonitoringTimeout)
                                this.startMonitoringTimeout = null
                        }
                        // Tentar novamente após 500ms
                        this.startMonitoringTimeout = setTimeout(() => {
                                this.startMonitoringTimeout = null
                                this.startProgressMonitoring()
                        }, 500)
                        return
                }
                
                this.lastProgressTime = Date.now()
                this.lastProgressValue = this.hls.media.currentTime || 0
                
                this.progressCheckInterval = setInterval(() => {
                        // Verificações mais rigorosas para evitar memory leaks
                        if (!this.active || !this.hls || !this.hls.media || !this.hls.media.parentNode) {
                                this.stopProgressMonitoring()
                                return
                        }
                        
                        const now = Date.now()
                        const currentTime = this.hls.media.currentTime
                        const timeSinceLastProgress = now - this.lastProgressTime
                        const timeSinceLastFragment = now - this.lastFragmentLoad
                        const timeSinceLastManifest = now - this.lastManifestUpdate
                        
                        // Se está em loading mas não há progresso há mais de 20s
                        if (this.state === 'loading') {
                                const noProgress = Math.abs(currentTime - this.lastProgressValue) < 0.1
                                // Verificar se já recebeu algum fragmento antes de considerar inatividade
                                const noFragmentActivity = this.lastFragmentLoad > 0 && timeSinceLastFragment > 20000
                                const isLive = this.mediatype === 'live'
                                
                                // Para live streams, verificar se playlist está sendo atualizada
                                // Só verificar se já recebeu pelo menos uma atualização de manifest
                                if (isLive && this.lastManifestUpdate > 0 && timeSinceLastManifest > 30000) {
                                        console.warn('HLS: Playlist stale, no updates for', Math.round(timeSinceLastManifest/1000), 's')
                                        // Tratar como erro fatal se playlist não atualiza há muito tempo
                                        if (timeSinceLastManifest > 60000) {
                                                console.error('HLS: Playlist stale for too long, treating as error')
                                                this.emit('error', 'Playlist stopped updating', true)
                                                this.setState('')
                                                return
                                        }
                                }
                                
                                // Se não há progresso e não há atividade de fragmentos há mais de 20s
                                if (noProgress && noFragmentActivity && timeSinceLastProgress > 20000) {
                                        console.warn('HLS: No playback progress and no fragment activity for', Math.round(timeSinceLastProgress/1000), 's')
                                        // Se já tentou carregar mas não há atividade, pode ser stream travado
                                        if (timeSinceLastProgress > 30000) {
                                                console.error('HLS: Playback stalled, no progress detected')
                                                if (!this.isReloading && !this.isSkippingSegment) {
                                                        // Tentar reload uma vez
                                                        this.isReloading = true
                                                        this.reload(() => {
                                                                this.isReloading = false
                                                        })
                                                }
                                        }
                                }
                        }
                        
                        // Atualizar valores
                        if (Math.abs(currentTime - this.lastProgressValue) >= 0.1) {
                                this.lastProgressTime = now
                                this.lastProgressValue = currentTime
                                // Resetar buffer stall count quando há progresso real
                                if (this.bufferStallCount > 0) {
                                        this.bufferStallCount = 0
                                }
                        }
                }, 2000) // Verificar a cada 2 segundos
        }
        stopProgressMonitoring() {
                if (this.progressCheckInterval) {
                        clearInterval(this.progressCheckInterval)
                        this.progressCheckInterval = null
                }
        }
        unload() {
                console.log('unload hls')
                
                // Cancelar timeout de inicialização do monitoramento
                if (this.startMonitoringTimeout) {
                        clearTimeout(this.startMonitoringTimeout)
                        this.startMonitoringTimeout = null
                }
                
                // Cancelar timeout do skipSegment
                if (this.skipSegmentTimeout) {
                        clearTimeout(this.skipSegmentTimeout)
                        this.skipSegmentTimeout = null
                }
                
                // Limpar monitoramento
                this.stopProgressMonitoring()
                
                // Clear operation flags to prevent stuck states
                this.isReloading = false
                this.isSkippingSegment = false
                this.bufferStallCount = 0
                this.lastFragmentLoad = 0
                this.lastManifestUpdate = 0

                if (this.hls) {
                        console.log('unload hls disconnect')
                        try {
                                // Remover event listeners antes de destroy
                                this.hls.off(Events.ERROR)
                                this.hls.off(Events.FRAG_LOADED)
                                this.hls.off(Events.FRAG_LOADING)
                                this.hls.off(Events.MANIFEST_PARSED)
                                this.hls.off(Events.LEVEL_UPDATED)
                                this.hls.destroy()
                        } catch (e) {
                                console.error('Error destroying HLS in unload:', e)
                        }
                        this.hls = null
                        this.object.src = ''
                        console.log('unload hls super.unload')
                        super.unload()
                        console.log('unload hls OK')
                }
                // Don't reset fatalErrorsCount here - it should persist across reloads                                                                         
        }
        destroy() {
                console.log('hls destroy')
                this.unload()
                super.destroy()
        }
}

export default MediaPlayerAdapterHTML5HLS
