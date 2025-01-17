// We define the WebSocketService as a global class.
window.WebSocketService = class {
  constructor(options = {}) {
    // Use the aggregator endpoint you want:
    this.url = options.url || 'wss://btc.coinybubble.com/ws/btc'
    this.onMessage = options.onMessage || (() => {})
    this.onConnected = options.onConnected || (() => {})
    this.onDisconnected = options.onDisconnected || (() => {})
    this.onError = options.onError || console.error
    this.debug = options.debug || false
    this.ws = null
  }

  log(...args) {
    if (this.debug) {
      console.log('[WS]', ...args)
    }
  }

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.log('Already connected')
      return
    }
    this.log('Connecting to', this.url)
    this.ws = new WebSocket(this.url)

    this.ws.onopen = () => {
      this.log('Connected')
      this.onConnected()
    }

    this.ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data)
        this.onMessage(data)
      } catch (err) {
        this.onError(err)
      }
    }

    this.ws.onclose = () => {
      this.log('Disconnected')
      this.onDisconnected()
    }

    this.ws.onerror = (err) => {
      this.log('Error', err)
      this.onError(err)
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}