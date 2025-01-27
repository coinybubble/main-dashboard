// src/js/main.js

const { createApp, ref, computed, onUnmounted } = Vue;

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

    const isDataStale = computed(() => {
      if (!lastMessageTime.value) return true;
      return Date.now() - lastMessageTime.value > 10000;
    });

    const snapshotCache = new Map();

    function getRecentSnapshots(seconds) {
      try {
        const now = Date.now();
        const cacheKey = `${seconds}-${Math.floor(now / 1000)}`;

        if (snapshotCache.has(cacheKey)) {
          return snapshotCache.get(cacheKey);
        }

        const cutoff = now - seconds * 1000;
        const result = snapshots.value.filter(
          s => s && s.timestamp && s.timestamp > cutoff
        );

        snapshotCache.set(cacheKey, result);

        if (snapshotCache.size > 10) {
          const oldestKey = Array.from(snapshotCache.keys())[0];
          snapshotCache.delete(oldestKey);
        }

        return result;
      } catch (error) {
        console.error('Error in getRecentSnapshots:', error);
        return [];
      }
    }

    const recentSnapshots10Sec = computed(() => getRecentSnapshots(10));
    const recentSnapshots30Sec = computed(() => getRecentSnapshots(30));
    const recentSnapshots2Min = computed(() => getRecentSnapshots(120));
    const recentSnapshots5Min = computed(() => getRecentSnapshots(300));

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
      try {
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
      } catch (err) {
        console.error('Error in aggregateMetrics:', err);
        return {
          buyVolumeTotal: 0,
          sellVolumeTotal: 0,
          avgPrice: 0,
          minPrice: 0,
          maxPrice: 0
        };
      }
    }

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

    const price10SecDiff30Sec = computed(() => {
      if (!price30Sec.value) return 0;
      return ((price10Sec.value - price30Sec.value) / price30Sec.value) * 100;
    });

    const buyVol30Sec = computed(() => metrics30Sec.value.buyVolumeTotal);
    const sellVol30Sec = computed(() => metrics30Sec.value.sellVolumeTotal);
    const buyVol2Min = computed(() => metrics2Min.value.buyVolumeTotal);
    const sellVol2Min = computed(() => metrics2Min.value.sellVolumeTotal);
    const buyVol5Min = computed(() => metrics5Min.value.buyVolumeTotal);
    const sellVol5Min = computed(() => metrics5Min.value.sellVolumeTotal);

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

    function calcBuyPercent(buy, sell) {
      const total = buy + sell;
      return total > 0 ? (buy / total) * 100 : 50;
    }
    const buyPercent30Sec = computed(() => calcBuyPercent(buyVol30Sec.value, sellVol30Sec.value));
    const buyPercent2Min = computed(() => calcBuyPercent(buyVol2Min.value, sellVol2Min.value));
    const buyPercent5Min = computed(() => calcBuyPercent(buyVol5Min.value, sellVol5Min.value));

    const timeFrameCompleteness = computed(() => {
      if (!startTime.value || isDataStale.value) {
        return { thirty: 0, twoMin: 0, fiveMin: 0 };
      }
      const elapsed = Date.now() - startTime.value;
      return {
        thirty: Math.min((elapsed / CONSTANTS.THIRTY_SECONDS) * 100, 100),
        twoMin: Math.min((elapsed / CONSTANTS.TWO_MINUTES) * 100, 100),
        fiveMin: Math.min((elapsed / CONSTANTS.FIVE_MINUTES) * 100, 100)
      };
    });

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
      return trades.sort((a, b) => b.timestamp - a.timestamp);
    }

    const MAX_TRADES = 50;
    const buyTradesLimited = computed(() => {
      const trades = processTrades(recentSnapshots5Min.value);
      return trades.filter(t => t.side === 'BUY').slice(0, MAX_TRADES);
    });
    const sellTradesLimited = computed(() => {
      const trades = processTrades(recentSnapshots5Min.value);
      return trades.filter(t => t.side === 'SELL').slice(0, MAX_TRADES);
    });

    const maxVol5Min = computed(() => {
      const trades = processTrades(recentSnapshots5Min.value);
      return Math.max(...trades.map(t => t.volume), 0);
    });

    function dynamicStyle(trade) {
      if (!trade || !maxVol5Min.value) {
        return { backgroundColor: 'transparent' };
      }
      const ratio = trade.volume / maxVol5Min.value;
      const alpha = 0.1 + Math.min(ratio * 0.8, 0.9);
      const color =
        trade.side === 'BUY'
          ? `rgba(34,197,94,${alpha})`
          : `rgba(239,68,68,${alpha})`;
      return { backgroundColor: color };
    }
    function getTradeSize(volume, maxVol) {
      if (!volume || !maxVol) return '';
      const ratio = volume / maxVol;
      if (ratio > 0.75) return 'huge';
      if (ratio > 0.5) return 'large';
      if (ratio > 0.25) return 'medium';
      return '';
    }

    // 10s diff bar
    const tradeDiff = computed(() => buyTradesCount10s.value - sellTradesCount10s.value);
    function centerBarStyle(diff) {
      const clamped = Math.max(-100, Math.min(diff, 100));
      const color = clamped >= 0 ? 'var(--bull)' : 'var(--bear)';
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

    function priceCenteredDiff(minVal, maxVal, currentVal) {
      if (!maxVal || maxVal <= minVal) return 0;
      const mid = (minVal + maxVal) / 2;
      const halfRange = (maxVal - minVal) / 2;
      return Math.max(-100, Math.min(((currentVal - mid) / halfRange) * 100, 100));
    }

    // 30s price diff
    const priceDiff30Sec = computed(() => {
      const minP = metrics30Sec.value.minPrice;
      const maxP = metrics30Sec.value.maxPrice;
      const curP = metrics30Sec.value.avgPrice;
      return { value: priceCenteredDiff(minP, maxP, curP) };
    });
    const priceDiffStyle30Sec = computed(() => centerBarStyle(priceDiff30Sec.value.value));

    // 2m price diff
    const priceDiff2Min = computed(() => {
      const minP = metrics2Min.value.minPrice;
      const maxP = metrics2Min.value.maxPrice;
      const curP = metrics2Min.value.avgPrice;
      return { value: priceCenteredDiff(minP, maxP, curP) };
    });
    const priceDiffStyle2Min = computed(() => centerBarStyle(priceDiff2Min.value.value));

    // 5m price diff
    const priceDiff5Min = computed(() => {
      const minP = metrics5Min.value.minPrice;
      const maxP = metrics5Min.value.maxPrice;
      const curP = metrics5Min.value.avgPrice;
      return { value: priceCenteredDiff(minP, maxP, curP) };
    });
    const priceDiffStyle5Min = computed(() => centerBarStyle(priceDiff5Min.value.value));

    const volumeBarDiff30Sec = computed(() => buyPercent30Sec.value - 50);
    const volumeBarDiff2Min = computed(() => buyPercent2Min.value - 50);
    const volumeBarDiff5Min = computed(() => buyPercent5Min.value - 50);

    const volumeBarStyle30Sec = computed(() => centerBarStyle(volumeBarDiff30Sec.value));
    const volumeBarStyle2Min = computed(() => centerBarStyle(volumeBarDiff2Min.value));
    const volumeBarStyle5Min = computed(() => centerBarStyle(volumeBarDiff5Min.value));

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
      return arr.sort((a, b) => b.totalVol - a.totalVol);
    });

    function exComputed(exchangeName, seconds) {
      if (!exchangeName) return { buyPercent: 50 };
      const cutoff = Date.now() - seconds * 1000;
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

    function formatNumber(n, type = 'default') {
      if (n === undefined || n === null || isNaN(n)) return '0';
      try {
        switch (type) {
          case 'price': return Number(n).toFixed(2);
          case 'volume': return Number(n).toFixed(3);
          case 'diff': return Number(n).toFixed(2);
          default: return Number(n).toFixed(2);
        }
      } catch (error) {
        console.error('Error formatting number:', error);
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

    let ws;
    try {
      ws = new WebSocketService({
        url: 'wss://trumpws.coinybubble.com/ws/trump',
        debug: true,
        onMessage: (msg) => {
          try {
            lastMessageTime.value = Date.now();
            if (!startTime.value) {
              startTime.value = Date.now();
            }
            if (msg && msg.exchange && msg.timestamp) {
              snapshots.value.push(msg);
              // Фильтруем старые данные (более 5 мин)
              const cutoff = Date.now() - CONSTANTS.FIVE_MINUTES;
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

    onUnmounted(() => {
      if (ws) ws.disconnect();
      snapshotCache.clear();
    });

    return {
      wsStatus,
      connectionError,
      isDataStale,

      // 10s
      buyTradesCount10s,
      sellTradesCount10s,
      price10Sec,
      price10SecDiff30Sec,

      // 30s, 2m, 5m
      price30Sec,
      price2Min,
      price5Min,

      // min/max  2m
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

      timeFrameCompleteness,

      buyTradesLimited,
      sellTradesLimited,
      maxVol5Min,
      dynamicStyle,
      getTradeSize,

      sortedExchanges5Min,
      exComputed,

      formatNumber,
      formatDiff,
      signOf,

      tenSecBuy: computed(() => metrics10Sec.value.buyVolumeTotal),
      tenSecSell: computed(() => metrics10Sec.value.sellVolumeTotal),
      tenSecTrendColor: computed(() =>
        metrics10Sec.value.buyVolumeTotal >= metrics10Sec.value.sellVolumeTotal
          ? 'var(--bull)'
          : 'var(--bear)'
      ),
      range2Min: computed(() => metrics2Min.value.maxPrice - metrics2Min.value.minPrice),

      tenSecRangeStyle2Min: computed(() => {
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
        return {
          left: leftPct + '%',
          width: widthPct + '%'
        };
      }),

      currentPriceMarkerStyle: computed(() => {
        const range = metrics2Min.value.maxPrice - metrics2Min.value.minPrice;
        if (!range) return { left: '0%' };
        const avg10s = metrics10Sec.value.avgPrice;
        // clamp в пределах minPrice..maxPrice
        const clamped = Math.min(
          Math.max(avg10s, metrics2Min.value.minPrice),
          metrics2Min.value.maxPrice
        );
        const pct = ((clamped - metrics2Min.value.minPrice) / range) * 100;
        return { left: pct + '%' };
      })
    };
  }
}).mount('#app');
