import { EventEmitter } from 'node:events'

// State machine for EPG ready states
export class EPGStateMachine extends EventEmitter {
  constructor() {
    super()
    this.currentState = 'uninitialized'
    this.states = {
      uninitialized: ['loading'],
      loading: ['loaded', 'error'],
      loaded: ['updating', 'error'],
      updating: ['loaded', 'error'],
      error: ['loading', 'uninitialized']
    }
  }
  
  canTransition(to) {
    return this.states[this.currentState]?.includes(to) || false
  }
  
  transition(to) {
    if (this.canTransition(to)) {
      const from = this.currentState
      this.currentState = to
      this.emit('stateChange', { from, to })
      return true
    }
    return false
  }
  
  getState() {
    return this.currentState
  }
  
  isReady() {
    return this.currentState === 'loaded'
  }
  
  isError() {
    return this.currentState === 'error'
  }
}
