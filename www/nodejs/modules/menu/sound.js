class Sounds {
  constructor() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.volume = 100;
    this.buffers = {};
    this.sourcePool = {};
    this.enabled = true;
    this.lastClickIn = 0; // Timestamp of last click-in
    this.lastClickInSequence = -1; // Current index in clickInSequence, -1 means no sequence
    this.clickInSequence = [
      // default click-in: e
      // default click-out: d
      // default warn: a
      // avoid repetition of the 'click-in' sound by using a sequence of sounds
      'b', 'a_', 'b', 'c_', 'b', 'a_', 'b', 'f_', 'd', 
      'f_', 'g', 'g', 'e', 'f_', 'e', 'e', 'f_', 'g',
      'f_', 'g', 'f_', 'g', 'f_', 'e', 'c_', 'd', 'c_'
    ];
    if (this.audioContext.state === 'suspended') {
      document.addEventListener('click', () => this.audioContext.resume(), { once: true });
    }
  }

  prepareSource(tag, vol) {
    if (!this.buffers[tag]) return;
    if (!this.sourcePool[tag]) this.sourcePool[tag] = [];
    else if (this.sourcePool[tag].length >= 2) return;

    const source = this.audioContext.createBufferSource();
    source.buffer = this.buffers[tag];

    const gainNode = this.audioContext.createGain();
    const finalGain = (vol * this.volume) / 10000;
    gainNode.gain.value = finalGain;

    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    this.sourcePool[tag].push({ source, gainNode });
  }

  async setup(tag, fileName) {
    if (!fileName) {
      fileName = tag;
    }
    const response = await fetch('assets/sounds/' + fileName + '.wav', { cache: 'force-cache' });
    const arrayBuffer = await response.arrayBuffer();
    this.buffers[tag] = await this.audioContext.decodeAudioData(arrayBuffer);
  }

  async play(tag, opts) {
    const start = Date.now();
    opts = Object.assign({
      volume: 100,
      time: 0, // ms min delay to resolve the sound
      vibrate: 25
    }, opts);
    let vol = opts.volume;
    if (!this.enabled || this.volume === 0 || vol <= 0) {
      console.log(`Skipping play for ${tag}: enabled=${this.enabled}, volume=${this.volume}, vol=${vol}`);
      return;
    }

    let soundTag = tag; // Actual sound to play
    if (tag === 'click-in') {
      const now = Date.now();
      const timeSinceLast = now - this.lastClickIn;
      if (timeSinceLast < 750 && this.lastClickIn !== 0) {
        // Continue sequence
        this.lastClickInSequence = (this.lastClickInSequence + 1) % this.clickInSequence.length;
      } else {
        // Start new sequence
        this.lastClickInSequence = 0;
      }
      this.lastClickIn = now;
      soundTag = this.clickInSequence[this.lastClickInSequence];
    } else {
      // Non-click-in sound: no reset of lastClickIn to preserve sequence timing
      this.lastClickInSequence = -1; // Reset sequence index for next click-in
    }

    if (typeof this.buffers[soundTag] === 'undefined') {
      try {
        await this.setup(soundTag)
      } catch (e) {
        console.error(`Error loading sound ${soundTag}: ${e}`);
        return;
      }
    }

    if (!this.sourcePool[soundTag] || this.sourcePool[soundTag].length === 0) {
      this.prepareSource(soundTag, vol);
    }

    const pool = this.sourcePool[soundTag];
    if (!pool || pool.length === 0) {
      console.error(`No source available for ${soundTag}`);
      return;
    }

    const { source, gainNode } = pool.shift();
    source.start(0);

    if (window.capacitor && opts.vibrate && navigator?.vibrate) {
      navigator.vibrate(opts.vibrate);
    }

    gainNode.gain.value = (vol * this.volume) / 10000; // lazily just to ensure the gain is set correctly
    this.prepareSource(soundTag, vol);
    const end = Date.now();
    if (opts.time && (end - start) < opts.time) {
      await new Promise(resolve => setTimeout(resolve, opts.time - (end - start)));
    }
  }
}

export default new Sounds();