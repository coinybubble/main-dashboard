// src/js/services/websocket.js

class WebSocketService {
  constructor(options = {}) {
    this.url = options.url || 'wss://trumpws.coinybubble.com/ws/trump';
    this.onMessage = options.onMessage || (() => {});
    this.onConnected = options.onConnected || (() => {});
    this.onDisconnected = options.onDisconnected || (() => {});
    this.onError = options.onError || console.error;
    this.debug = options.debug || false;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectTimeout = 1000;
    this.mockMode = false;
    this.mockInterval = null;
    this.isConnecting = false;
  }

  log(...args) {
    if (this.debug) {
      console.log('[WS]', ...args);
    }
  }

  connect() {
    if (this.isConnecting) {
      this.log('Connection attempt is already in progress');
      return;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.log('Already connected');
      return;
    }

    this.isConnecting = true;
    try {
      this.log('Connecting to', this.url);
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.log('Connected');
        this.reconnectAttempts = 0;
        this.isConnecting = false;
        this.onConnected();

        if (this.mockMode) {
          this.stopMockData();
        }
      };

      this.ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (this.validateData(data)) {
            this.onMessage(data);
          }
        } catch (err) {
          this.onError('Message parsing error:', err);
          this.fallbackToMockData();
        }
      };

      this.ws.onclose = () => {
        this.log('Disconnected');
        this.isConnecting = false;
        this.onDisconnected();
        this.fallbackToMockData();
        this.reconnect();
      };

      this.ws.onerror = (err) => {
        this.log('Error:', err);
        this.isConnecting = false;
        this.onError(err);
        this.fallbackToMockData();
      };
    } catch (err) {
      this.log('Connection failed:', err);
      this.isConnecting = false;
      this.fallbackToMockData();
    }
  }

  fallbackToMockData() {
    if (this.mockMode) return;
    this.mockMode = true;
    this.log('Falling back to mock data');
    this.mockInterval = setInterval(() => {
      const mockData = this.generateMockData();
      this.onMessage(mockData);
    }, 1000);
  }

  stopMockData() {
    if (this.mockInterval) {
      clearInterval(this.mockInterval);
      this.mockInterval = null;
    }
    this.mockMode = false;
  }

  generateMockData() {
    const basePrice = 27000 + Math.random() * 1000;
    const volume = Math.random() * 3;
    const timestamp = Date.now();
    const exchanges = ['binance', 'coinbase', 'kraken', 'bybit', 'okx'];
    const exchange = exchanges[Math.floor(Math.random() * exchanges.length)];

    return {
      exchange,
      timestamp,
      buy_volume: Math.random() > 0.5 ? volume : 0,
      sell_volume: Math.random() > 0.5 ? volume : 0,
      buy_avg_price: basePrice + Math.random() * 10,
      sell_avg_price: basePrice - Math.random() * 10,
      buy_count: Math.floor(Math.random() * 5),
      sell_count: Math.floor(Math.random() * 5)
    };
  }

  validateData(data) {
    if (!data || typeof data !== 'object') return false;
    const requiredFields = ['exchange', 'timestamp'];
    const hasRequired = requiredFields.every(f => f in data);
    if (!hasRequired) {
      this.log('Invalid data format:', data);
      return false;
    }
    const hasValidVolumes =
      (
        typeof data.buy_volume === 'number' &&
        (!data.buy_volume || data.buy_avg_price > 0)
      ) ||
      (
        typeof data.sell_volume === 'number' &&
        (!data.sell_volume || data.sell_avg_price > 0)
      );
    if (!hasValidVolumes) {
      this.log('Invalid volume data:', data);
      return false;
    }
    if (typeof data.timestamp !== 'number' || data.timestamp <= 0) {
      this.log('Invalid timestamp:', data);
      return false;
    }
    return true;
  }

  reconnect() {
    if (this.isConnecting) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log('Max reconnection attempts reached');
      return;
    }
    this.reconnectAttempts++;
    const delay = this.reconnectTimeout * Math.pow(2, this.reconnectAttempts - 1);
    this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect() {
    this.stopMockData();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

window.WebSocketService = WebSocketService;
