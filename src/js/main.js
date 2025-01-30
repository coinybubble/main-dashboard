// src/js/main.js

const { createApp, ref, computed, onMounted, onUnmounted } = Vue;

const CONSTANTS = {
  THIRTY_SECONDS: 30000,
  TWO_MINUTES: 120000,
  FIVE_MINUTES: 300000,
  TEN_SECONDS: 10000,
  MAX_SNAPSHOTS: 1000
};

createApp({
  setup() {
    const snapshots = ref([]);
    const startTime = ref(null);
    const lastMessageTime = ref(null);
    const wsStatus = ref('disconnected');
    const connectionError = ref(null);

    // We need a reactive current time to recalc progress over time
    const currentTime = ref(Date.now());
    let timerId = null;

    onMounted(() => {
      // Update 'currentTime' every second
      timerId = setInterval(() => {
        currentTime.value = Date.now();
      }, 1000);
    });

    onUnmounted(() => {
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
      if (ws) ws.disconnect();
      snapshotCache.clear();
    });

    // If no new data for >10s, we mark data as stale
    const isDataStale = computed(() => {
      if (!lastMessageTime.value) return true;
      return currentTime.value - lastMessageTime.value > 10000;
    });

    const snapshotCache = new Map();

    function getRecentSnapshots(seconds) {
      const now = currentTime.value;
      const cacheKey = `${seconds}-${Math.floor(now / 1000)}`;
      if (snapshotCache.has(cacheKey)) {
        return snapshotCache.get(cacheKey);
      }
      const cutoff = now - seconds * 1000;
      const result = snapshots.value.filter(
        s => s && s.timestamp && s.timestamp > cutoff
      );
      snapshotCache.set(cacheKey, result);

      // Limit cache size
      if (snapshotCache.size > 10) {
        const oldestKey = Array.from(snapshotCache.keys())[0];
        snapshotCache.delete(oldestKey);
      }
      return result;
    }

    // Computed slices for 10s, 30s, 2m, 5m
    const recentSnapshots10Sec = computed(() => getRecentSnapshots(10));
    const recentSnapshots30Sec = computed(() => getRecentSnapshots(30));
    const recentSnapshots2Min = computed(() => getRecentSnapshots(120));
    const recentSnapshots5Min = computed(() => getRecentSnapshots(300));

    // 10s buy/sell trade counts
    const buyTradesCount10s = computed(() =>
      recentSnapshots10Sec.value.reduce((sum, s) => sum + (s.buy_count || 0), 0)
    );
    const sellTradesCount10s = computed(() =>
      recentSnapshots10Sec.value.reduce((sum, s) => sum + (s.sell_count || 0), 0)
    );

    function aggregateMetrics(arr) {
      if (!arr || !arr.length) {
        return {
          buyVolumeTotal: 0,
          sellVolumeTotal: 0,
          avgPrice: 0,
          minPrice: 0,
          maxPrice: 0
        };
      }
      let buySum = 0;
      let sellSum = 0;
      const prices = [];

      arr.forEach(s => {
        buySum += s.buy_volume || 0;
        sellSum += s.sell_volume || 0;
        if (s.buy_volume > 0 && s.buy_avg_price > 0) {
          prices.push(s.buy_avg_price);
        }
        if (s.sell_volume > 0 && s.sell_avg_price > 0) {
          prices.push(s.sell_avg_price);
        }
      });

      const avgPrice = prices.length
        ? prices.reduce((a, b) => a + b, 0) / prices.length
        : 0;
      const minP = prices.length ? Math.min(...prices) : 0;
      const maxP = prices.length ? Math.max(...prices) : 0;

      return {
        buyVolumeTotal: buySum,
        sellVolumeTotal: sellSum,
        avgPrice,
        minPrice: minP,
        maxPrice: maxP
      };
    }

    // Metrics for 10s, 30s, 2m, 5m
    const metrics10Sec = computed(() => aggregateMetrics(recentSnapshots10Sec.value));
    const metrics30Sec = computed(() => aggregateMetrics(recentSnapshots30Sec.value));
    const metrics2Min = computed(() => aggregateMetrics(recentSnapshots2Min.value));
    const metrics5Min = computed(() => aggregateMetrics(recentSnapshots5Min.value));

    const price10Sec = computed(() => metrics10Sec.value.avgPrice);
    const price30Sec = computed(() => metrics30Sec.value.avgPrice);
    const price2Min = computed(() => metrics2Min.value.avgPrice);
    const price5Min = computed(() => metrics5Min.value.avgPrice);

    const minPrice2Min = computed(() => metrics2Min.value.minPrice);
    const maxPrice2Min = computed(() => metrics2Min.value.maxPrice);

    // 10s vs 30s diff in %
    const price10SecDiff30Sec = computed(() => {
      if (!price30Sec.value) return 0;
      return ((price10Sec.value - price30Sec.value) / price30Sec.value) * 100;
    });

    // Volumes
    const buyVol30Sec = computed(() => metrics30Sec.value.buyVolumeTotal);
    const sellVol30Sec = computed(() => metrics30Sec.value.sellVolumeTotal);
    const buyVol2Min = computed(() => metrics2Min.value.buyVolumeTotal);
    const sellVol2Min = computed(() => metrics2Min.value.sellVolumeTotal);
    const buyVol5Min = computed(() => metrics5Min.value.buyVolumeTotal);
    const sellVol5Min = computed(() => metrics5Min.value.sellVolumeTotal);

    // (buy - sell)
    function calcDiff(buy, sell) {
      const diff = buy - sell;
      return {
        value: Math.abs(diff),
        sign: Math.sign(diff)
      };
    }
    const volumeDiff30Sec = computed(() => calcDiff(buyVol30Sec.value, sellVol30Sec.value));
    const volumeDiff2Min = computed(() => calcDiff(buyVol2Min.value, sellVol2Min.value));
    const volumeDiff5Min = computed(() => calcDiff(buyVol5Min.value, sellVol5Min.value));

    // Buy ratio in %
    function calcBuyPercent(buy, sell) {
      const total = buy + sell;
      return total > 0 ? (buy / total) * 100 : 50;
    }
    const buyPercent30Sec = computed(() => calcBuyPercent(buyVol30Sec.value, sellVol30Sec.value));
    const buyPercent2Min = computed(() => calcBuyPercent(buyVol2Min.value, sellVol2Min.value));
    const buyPercent5Min = computed(() => calcBuyPercent(buyVol5Min.value, sellVol5Min.value));

    /**
     * Timeframe completeness from 0% to 100%.
     * We rely on 'startTime' + 'currentTime' to see how long it's been since we connected.
     */
    const timeFrameCompleteness = computed(() => {
      if (!startTime.value) {
        return { thirty: 0, twoMin: 0, fiveMin: 0 };
      }
      const elapsed = currentTime.value - startTime.value;
      return {
        thirty: Math.min((elapsed / CONSTANTS.THIRTY_SECONDS) * 100, 100),
        twoMin: Math.min((elapsed / CONSTANTS.TWO_MINUTES) * 100, 100),
        fiveMin: Math.min((elapsed / CONSTANTS.FIVE_MINUTES) * 100, 100)
      };
    });

    // Collect trades from snapshots for the last 5m
    function processTrades(snapArray) {
      if (!Array.isArray(snapArray)) return [];
      const trades = [];
      snapArray.forEach(s => {
        if (!s) return;
        if (s.buy_volume > 0 && s.buy_avg_price > 0) {
          trades.push({
            side: 'BUY',
            volume: s.buy_volume,
            count: s.buy_count || 1,
            price: s.buy_avg_price,
            timestamp: s.timestamp
          });
        }
        if (s.sell_volume > 0 && s.sell_avg_price > 0) {
          trades.push({
            side: 'SELL',
            volume: s.sell_volume,
            count: s.sell_count || 1,
            price: s.sell_avg_price,
            timestamp: s.timestamp
          });
        }
      });
      // Sort descending by timestamp
      return trades.sort((a, b) => b.timestamp - a.timestamp);
    }

    // CHANGED: reduce max trades from 50 to 25
    const MAX_TRADES = 25;

    const buyTradesLimited = computed(() => {
      const trades = processTrades(recentSnapshots5Min.value);
      return trades.filter(t => t.side === 'BUY').slice(0, MAX_TRADES);
    });
    const sellTradesLimited = computed(() => {
      const trades = processTrades(recentSnapshots5Min.value);
      return trades.filter(t => t.side === 'SELL').slice(0, MAX_TRADES);
    });

    // Maximum volume in last 5m for highlighting big trades
    const maxVol5Min = computed(() => {
      const trades = processTrades(recentSnapshots5Min.value);
      return Math.max(...trades.map(t => t.volume), 0);
    });

    // Background color in trades list based on volume ratio
    function dynamicStyle(trade) {
      if (!trade || !maxVol5Min.value) {
        return { backgroundColor: 'transparent' };
      }
      const ratio = trade.volume / maxVol5Min.value;
      const alpha = 0.1 + Math.min(ratio * 0.8, 0.9);
      const color = trade.side === 'BUY'
        ? `rgba(34,197,94,${alpha})`
        : `rgba(239,68,68,${alpha})`;
      return { backgroundColor: color };
    }

    // Size class based on relative volume
    function getTradeSize(volume, maxVol) {
      if (!volume || !maxVol) return '';
      const ratio = volume / maxVol;
      if (ratio > 0.75) return 'text-lg font-bold';
      if (ratio > 0.5) return 'text-base font-semibold';
      if (ratio > 0.25) return 'font-semibold';
      return '';
    }

    // 10s trades difference
    const tradeDiff = computed(() => buyTradesCount10s.value - sellTradesCount10s.value);

    // Center-based progress bar style
    function centerBarStyle(diff) {
      const clamped = Math.max(-100, Math.min(diff, 100));
      const color = clamped >= 0 ? 'rgb(34 197 94)' : 'rgb(239 68 68)';
      return {
        width: Math.abs(clamped) + '%',
        marginLeft: clamped >= 0 ? '50%' : (50 + clamped) + '%',
        background: color
      };
    }

    const tradeDiffStyle = computed(() => {
      const total = buyTradesCount10s.value + sellTradesCount10s.value;
      if (!total) {
        return { width: '0%', marginLeft: '50%', background: 'transparent' };
      }
      const diffPercent = (tradeDiff.value / total) * 100;
      return centerBarStyle(diffPercent);
    });

    // price-centered diff
    function priceCenteredDiff(minVal, maxVal, currentVal) {
      if (!maxVal || maxVal <= minVal) return 0;
      const mid = (minVal + maxVal) / 2;
      const halfRange = (maxVal - minVal) / 2;
      return Math.max(-100, Math.min(((currentVal - mid) / halfRange) * 100, 100));
    }

    // Price diffs for 30s, 2m, 5m
    const priceDiff30Sec = computed(() => {
      const { minPrice, maxPrice, avgPrice } = metrics30Sec.value;
      return { value: priceCenteredDiff(minPrice, maxPrice, avgPrice) };
    });
    const priceDiffStyle30Sec = computed(() => centerBarStyle(priceDiff30Sec.value.value));

    const priceDiff2Min = computed(() => {
      const { minPrice, maxPrice, avgPrice } = metrics2Min.value;
      return { value: priceCenteredDiff(minPrice, maxPrice, avgPrice) };
    });
    const priceDiffStyle2Min = computed(() => centerBarStyle(priceDiff2Min.value.value));

    const priceDiff5Min = computed(() => {
      const { minPrice, maxPrice, avgPrice } = metrics5Min.value;
      return { value: priceCenteredDiff(minPrice, maxPrice, avgPrice) };
    });
    const priceDiffStyle5Min = computed(() => centerBarStyle(priceDiff5Min.value.value));

    // Volume bars (30s, 2m, 5m)
    const volumeBarDiff30Sec = computed(() => buyPercent30Sec.value - 50);
    const volumeBarDiff2Min = computed(() => buyPercent2Min.value - 50);
    const volumeBarDiff5Min = computed(() => buyPercent5Min.value - 50);

    const volumeBarStyle30Sec = computed(() => centerBarStyle(volumeBarDiff30Sec.value));
    const volumeBarStyle2Min = computed(() => centerBarStyle(volumeBarDiff2Min.value));
    const volumeBarStyle5Min = computed(() => centerBarStyle(volumeBarDiff5Min.value));

    // Exchanges (5m)
    const sortedExchanges5Min = computed(() => {
      const map = new Map();
      recentSnapshots5Min.value.forEach(s => {
        if (!s || !s.exchange) return;
        if (!map.has(s.exchange)) {
          map.set(s.exchange, {
            name: s.exchange,
            totalVol: 0,
            lastPrice: 0,
            timestamp: 0
          });
        }
        const info = map.get(s.exchange);
        const vol = (s.buy_volume || 0) + (s.sell_volume || 0);
        info.totalVol += vol;
        if (s.timestamp > info.timestamp) {
          if (s.buy_volume > 0 && s.buy_avg_price > 0) {
            info.lastPrice = s.buy_avg_price;
            info.timestamp = s.timestamp;
          } else if (s.sell_volume > 0 && s.sell_avg_price > 0) {
            info.lastPrice = s.sell_avg_price;
            info.timestamp = s.timestamp;
          }
        }
      });
      const basePrice = metrics5Min.value.avgPrice;
      const arr = [];
      map.forEach(v => {
        const diff = basePrice && v.lastPrice
          ? ((v.lastPrice - basePrice) / basePrice) * 100
          : 0;
        arr.push({
          name: v.name,
          totalVol: v.totalVol,
          price: v.lastPrice,
          diff
        });
      });
      // sort by volume desc
      return arr.sort((a, b) => b.totalVol - a.totalVol);
    });

    // For each exchange/timeframe: buy percentage
    function exComputed(exchangeName, seconds) {
      if (!exchangeName) return { buyPercent: 50 };
      const now = currentTime.value;
      const cutoff = now - seconds * 1000;
      const exArr = snapshots.value.filter(
        s => s && s.exchange === exchangeName && s.timestamp > cutoff
      );
      let buy = 0, sell = 0;
      exArr.forEach(s => {
        buy += s.buy_volume || 0;
        sell += s.sell_volume || 0;
      });
      return { buyPercent: calcBuyPercent(buy, sell) };
    }

    // Number formatting
    function formatNumber(n, type = 'default') {
      if (n === undefined || n === null || isNaN(n)) return '0';
      try {
        switch (type) {
          case 'price':
            return Number(n).toFixed(2);
          case 'volume':
            // 3 decimals for trades
            return Number(n).toFixed(3);
          case 'volumeShort':
            // 1 decimal for top blocks, exchanges
            return Number(n).toFixed(1);
          case 'diff':
            return Number(n).toFixed(2);
          default:
            return Number(n).toFixed(2);
        }
      } catch {
        return '0';
      }
    }
    function formatDiff(n) {
      if (!n || isNaN(n)) return '(0)';
      const sign = n > 0 ? '+' : '';
      return `(${sign}${formatNumber(n, 'diff')}%)`;
    }
    function signOf(val) {
      if (typeof val !== 'number') return '';
      return val > 0 ? '+' : val < 0 ? '-' : '';
    }

    // 10s highlight inside 2m
    const tenSecTrendColor = computed(() =>
      metrics10Sec.value.buyVolumeTotal >= metrics10Sec.value.sellVolumeTotal
        ? 'rgb(34 197 94)'
        : 'rgb(239 68 68)'
    );
    const tenSecRangeStyle2Min = computed(() => {
      const range = metrics2Min.value.maxPrice - metrics2Min.value.minPrice;
      if (!range) return { left: '0%', width: '0%' };
      const min10s = metrics10Sec.value.minPrice;
      const max10s = metrics10Sec.value.maxPrice;
      if (!min10s || !max10s) return { left: '0%', width: '0%' };

      const leftVal = Math.max(min10s, metrics2Min.value.minPrice);
      const rightVal = Math.min(max10s, metrics2Min.value.maxPrice);
      let leftPct = ((leftVal - metrics2Min.value.minPrice) / range) * 100;
      let widthPct = ((rightVal - leftVal) / range) * 100;
      leftPct = Math.max(0, Math.min(leftPct, 100));
      widthPct = Math.max(0, Math.min(widthPct, 100 - leftPct));
      return { left: leftPct + '%', width: widthPct + '%' };
    });
    const currentPriceMarkerStyle = computed(() => {
      const range = metrics2Min.value.maxPrice - metrics2Min.value.minPrice;
      if (!range) return { left: '0%' };
      const avg10s = metrics10Sec.value.avgPrice;
      const clamped = Math.min(
        Math.max(avg10s, metrics2Min.value.minPrice),
        metrics2Min.value.maxPrice
      );
      const pct = ((clamped - metrics2Min.value.minPrice) / range) * 100;
      return { left: pct + '%' };
    });

    // WebSocket init
    let ws;
    try {
      ws = new WebSocketService({
        url: 'wss://trumpws.coinybubble.com/ws/trump',
        debug: true,
        onMessage: (msg) => {
          try {
            lastMessageTime.value = currentTime.value;
            if (!startTime.value) {
              // Set the start time at the moment of the first valid message
              startTime.value = currentTime.value;
            }
            if (msg && msg.exchange && msg.timestamp) {
              snapshots.value.push(msg);
              // Filter out older than 5 minutes
              const cutoff = currentTime.value - CONSTANTS.FIVE_MINUTES;
              snapshots.value = snapshots.value
                .filter(s => s.timestamp > cutoff)
                .slice(-CONSTANTS.MAX_SNAPSHOTS);
              snapshotCache.clear();
            }
          } catch (error) {
            console.error('Error processing message:', error);
            connectionError.value = error.message;
          }
        },
        onConnected: () => {
          wsStatus.value = 'connected';
          connectionError.value = null;
          snapshots.value = [];
          // do not set startTime here, wait for the first actual message
          startTime.value = null;
          lastMessageTime.value = null;
          snapshotCache.clear();
        },
        onDisconnected: () => {
          wsStatus.value = 'disconnected';
        },
        onError: (error) => {
          console.error('WebSocket error:', error);
          connectionError.value = error.message;
        }
      });
      ws.connect();
    } catch (error) {
      console.error('Failed to initialize WebSocket:', error);
      connectionError.value = error.message;
    }

    return {
      wsStatus,
      connectionError,
      isDataStale,
      currentTime,

      // 10s trades
      buyTradesCount10s,
      sellTradesCount10s,
      price10Sec,
      price10SecDiff30Sec,

      // 30s, 2m, 5m
      price30Sec,
      price2Min,
      price5Min,
      minPrice2Min,
      maxPrice2Min,

      buyVol30Sec,
      sellVol30Sec,
      buyVol2Min,
      sellVol2Min,
      buyVol5Min,
      sellVol5Min,

      volumeDiff30Sec,
      volumeDiff2Min,
      volumeDiff5Min,

      buyPercent30Sec,
      buyPercent2Min,
      buyPercent5Min,

      timeFrameCompleteness,

      // Trades list (25 max)
      buyTradesLimited,
      sellTradesLimited,
      maxVol5Min,
      dynamicStyle,
      getTradeSize,

      // Exchanges
      sortedExchanges5Min,
      exComputed,

      // Diffs, bars
      tradeDiff,
      tradeDiffStyle,
      priceDiff30Sec,
      priceDiffStyle30Sec,
      priceDiff2Min,
      priceDiffStyle2Min,
      priceDiff5Min,
      priceDiffStyle5Min,

      volumeBarDiff30Sec,
      volumeBarDiff2Min,
      volumeBarDiff5Min,
      volumeBarStyle30Sec,
      volumeBarStyle2Min,
      volumeBarStyle5Min,

      // Helpers
      formatNumber,
      formatDiff,
      signOf,

      // 10s highlight on 2m slider
      tenSecTrendColor,
      tenSecRangeStyle2Min,
      currentPriceMarkerStyle
    };
  }
}).mount('#app');
