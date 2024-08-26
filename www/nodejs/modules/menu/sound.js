export class Sounds {
    constructor() {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.buffers = {}; 
      this.enabled = true;
      this.volume = 100;
    }
  
    async setup(tag) {
      const response = await fetch('assets/sounds/' + tag + '.mp3');
      const arrayBuffer = await response.arrayBuffer();
      this.buffers[tag] = await this.audioContext.decodeAudioData(arrayBuffer);
    }
  
    play(tag, vol = 100) {
      if (!this.enabled) return;
  
      vol *= this.volume / 100;
  
      if (typeof this.buffers[tag] === 'undefined') {
        this.setup(tag)
          .then(() => this.play(tag, vol)) // Tentar reproduzir novamente após carregar
          .catch(error => console.error("Erro ao carregar o som:", error)); 
        return; 
      }
  
      const source = this.audioContext.createBufferSource();
      source.buffer = this.buffers[tag];
  
      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = vol / 100; 
      source.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
  
      source.start(0);
  
      if (window.capacitor && navigator && navigator.vibrate) {
        navigator.vibrate(25);
      }
    }
}