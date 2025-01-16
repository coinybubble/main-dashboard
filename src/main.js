const { createApp, ref, computed } = Vue

// Time constants in milliseconds
const CONSTANTS = {
  THIRTY_SECONDS: 30000,
  TWO_MINUTES: 120000,
  FIVE_MINUTES: 300000,
  TEN_SECONDS: 10000
}

createApp({
  setup() {
    const snapshots = ref([])
    const startTime = ref(null)
    const lastMessageTime = ref(null)
    const wsStatus = ref('disconnected')

    // Data is considered stale if no new messages for 10s
    const isDataStale = computed(() => {
      if (!lastMessageTime.value) return true
      return Date.now() - lastMessageTime.value > 10000
    })

    // Recent snapshots by timeframe
    const recentSnapshots30Sec = computed(() => {
      const cutoff = Date.now() - CONSTANTS.THIRTY_SECONDS
      return snapshots.value.filter(s => s.timestamp > cutoff)
    })
    const recentSnapshots2Min = computed(() => {
      const cutoff = Date.now() - CONSTANTS.TWO_MINUTES
      return snapshots.value.filter(s => s.timestamp > cutoff)
    })
    const recentSnapshots5Min = computed(() => {
      const cutoff = Date.now() - CONSTANTS.FIVE_MINUTES
      return snapshots.value.filter(s => s.timestamp > cutoff)
    })
    const recentSnapshots10Sec = computed(() => {
      const cutoff = Date.now() - CONSTANTS.TEN_SECONDS
      return snapshots.value.filter(s => s.timestamp > cutoff)
    })

    // Aggregation function
    function aggregateMetrics(snapArray) {
      if (!snapArray.length) {
        return {
          buyVolumeTotal: 0,
          sellVolumeTotal: 0,
          avgPrice: 0,
          minPrice: 0,
          maxPrice: 0
        }
      }
      let buyVolSum = 0
      let sellVolSum = 0
      let sumPV = 0
      let sumV = 0
      const priceCandidates = []

      snapArray.forEach(snap => {
        buyVolSum += snap.buy_volume
        sellVolSum += snap.sell_volume

        sumPV += snap.buy_volume * snap.buy_avg_price
        sumPV += snap.sell_volume * snap.sell_avg_price
        sumV += snap.buy_volume + snap.sell_volume

        if (snap.buy_min_price > 0) {
          priceCandidates.push(snap.buy_min_price, snap.buy_max_price)
        }
        if (snap.sell_min_price > 0) {
          priceCandidates.push(snap.sell_min_price, snap.sell_max_price)
        }
      })

      const vwap = sumV ? sumPV / sumV : 0
      const minPrice = priceCandidates.length ? Math.min(...priceCandidates) : 0
      const maxPrice = priceCandidates.length ? Math.max(...priceCandidates) : 0

      return {
        buyVolumeTotal: buyVolSum,
        sellVolumeTotal: sellVolSum,
        avgPrice: vwap,
        minPrice,
        maxPrice
      }
    }

    // Metrics for 30s, 2m, 5m, 10s
    const metrics30Sec = computed(() => aggregateMetrics(recentSnapshots30Sec.value))
    const metrics2Min = computed(() => aggregateMetrics(recentSnapshots2Min.value))
    const metrics5Min = computed(() => aggregateMetrics(recentSnapshots5Min.value))
    const metrics10Sec = computed(() => aggregateMetrics(recentSnapshots10Sec.value))

    // Prices & VWAP shortcuts
    const price30Sec = computed(() => metrics30Sec.value.avgPrice)
    const vwap30Sec = computed(() => metrics30Sec.value.avgPrice)
    const minPrice30Sec = computed(() => metrics30Sec.value.minPrice)
    const maxPrice30Sec = computed(() => metrics30Sec.value.maxPrice)

    const price2Min = computed(() => metrics2Min.value.avgPrice)
    const vwap2Min = computed(() => metrics2Min.value.avgPrice)
    const minPrice2Min = computed(() => metrics2Min.value.minPrice)
    const maxPrice2Min = computed(() => metrics2Min.value.maxPrice)

    const price5Min = computed(() => metrics5Min.value.avgPrice)
    const vwap5Min = computed(() => metrics5Min.value.avgPrice)
    const minPrice5Min = computed(() => metrics5Min.value.minPrice)
    const maxPrice5Min = computed(() => metrics5Min.value.maxPrice)

    // Volumes
    const buyVol30Sec = computed(() => metrics30Sec.value.buyVolumeTotal)
    const sellVol30Sec = computed(() => metrics30Sec.value.sellVolumeTotal)

    const buyVol2Min = computed(() => metrics2Min.value.buyVolumeTotal)
    const sellVol2Min = computed(() => metrics2Min.value.sellVolumeTotal)

    const buyVol5Min = computed(() => metrics5Min.value.buyVolumeTotal)
    const sellVol5Min = computed(() => metrics5Min.value.sellVolumeTotal)

    // Differences
    function calcDiff(buy, sell) {
      const diff = buy - sell
      return {
        value: Math.abs(diff),
        sign: Math.sign(diff)
      }
    }
    const volumeDiff30Sec = computed(() => calcDiff(buyVol30Sec.value, sellVol30Sec.value))
    const volumeDiff2Min = computed(() => calcDiff(buyVol2Min.value, sellVol2Min.value))
    const volumeDiff5Min = computed(() => calcDiff(buyVol5Min.value, sellVol5Min.value))

    // Buy % calculations
    function calcBuyPercent(buy, sell) {
      const total = buy + sell
      return total ? (buy / total) * 100 : 50
    }
    const buyPercent30Sec = computed(() => calcBuyPercent(buyVol30Sec.value, sellVol30Sec.value))
    const buyPercent2Min = computed(() => calcBuyPercent(buyVol2Min.value, sellVol2Min.value))
    const buyPercent5Min = computed(() => calcBuyPercent(buyVol5Min.value, sellVol5Min.value))

    // Pseudo-trades from 5-min snapshots
    const pseudoTrades = computed(() => {
      const arr = []
      recentSnapshots5Min.value.forEach(snap => {
        if (snap.buy_volume > 0) {
          arr.push({
            side: 'BUY',
            volume: snap.buy_volume,
            price: snap.buy_max_price,
            timestamp: snap.timestamp
          })
        }
        if (snap.sell_volume > 0) {
          arr.push({
            side: 'SELL',
            volume: snap.sell_volume,
            price: snap.sell_min_price,
            timestamp: snap.timestamp
          })
        }
      })
      // Sort by timestamp desc
      return arr.sort((a,b) => b.timestamp - a.timestamp)
    })

    const MAX_TRADES = 50
    const buyTradesLimited = computed(() => {
      const buys = pseudoTrades.value.filter(t => t.side === 'BUY')
      return buys.slice(0, MAX_TRADES).map(t => ({ ...t }))
    })
    const sellTradesLimited = computed(() => {
      const sells = pseudoTrades.value.filter(t => t.side === 'SELL')
      return sells.slice(0, MAX_TRADES).map(t => ({ ...t }))
    })

    // Max volume for 5-min to scale bar widths
    const maxVol5Min = computed(() => {
      let maxVol = 0
      pseudoTrades.value.forEach(t => {
        if (t.volume > maxVol) {
          maxVol = t.volume
        }
      })
      return maxVol
    })

    // Dynamic style for trades (background color depends on volume ratio)
    function dynamicStyle(trade) {
      const ratio = maxVol5Min.value ? (trade.volume / maxVol5Min.value) : 0
      const alpha = 0.1 + ratio * 0.8
      const color = trade.side === 'BUY'
        ? `rgba(34, 197, 94, ${alpha})`   // green
        : `rgba(239, 68, 68, ${alpha})`  // red
      return { backgroundColor: color }
    }

    // Sizing: huge, large, medium, etc.
    function getTradeSize(volume, maxVol) {
      if (!maxVol) return ''
      const ratio = volume / maxVol
      if (ratio > 0.75) return 'huge'
      if (ratio > 0.5) return 'large'
      if (ratio > 0.25) return 'medium'
      return ''
    }

    // Last 10s trades count (for speedometer)
    const last10SecTradesCount = computed(() => {
      const cutoff = Date.now() - CONSTANTS.TEN_SECONDS
      return pseudoTrades.value.filter(t => t.timestamp > cutoff).length
    })

    // Speedometer arrow style
    const speedometerArrowStyle = computed(() => {
      const count = last10SecTradesCount.value
      const maxCount = 100
      const angle = Math.min(count / maxCount, 1) * 180
      return { transform: `translateX(-50%) rotate(${angle - 90}deg)` }
    })

    // Range for 2 min
    const range2Min = computed(() => {
      return maxPrice2Min.value - minPrice2Min.value
    })

    // 10s buy/sell
    const tenSecBuy = computed(() => metrics10Sec.value.buyVolumeTotal)
    const tenSecSell = computed(() => metrics10Sec.value.sellVolumeTotal)

    // The color of the 10s segment: green if buy >= sell, else red
    const tenSecTrendColor = computed(() => {
      return tenSecBuy.value >= tenSecSell.value ? 'var(--bull)' : 'var(--bear)'
    })

    // min/max for 10s
    const minPrice10Sec = computed(() => metrics10Sec.value.minPrice)
    const maxPrice10Sec = computed(() => metrics10Sec.value.maxPrice)

    // The position of the 10s segment inside 2m
    const slider10SecStyle2Min = computed(() => {
      if (!range2Min.value) {
        return { left: '0%', width: '0%' }
      }
      const leftVal = Math.max(minPrice10Sec.value, minPrice2Min.value)
      const rightVal = Math.min(maxPrice10Sec.value, maxPrice2Min.value)
      const leftPct = ((leftVal - minPrice2Min.value) / range2Min.value) * 100
      const widthPct = ((rightVal - leftVal) / range2Min.value) * 100
      return {
        left: leftPct + '%',
        width: widthPct + '%'
      }
    })

    // Difference: price2Min vs. vwap30Sec
    const price2MinDiff30Sec = computed(() => {
      if (!vwap30Sec.value) return 0
      const base = vwap30Sec.value
      const p2m = price2Min.value
      if (!base) return 0
      return ((p2m - base) / base) * 100
    })

    // White marker for current price
    const currentPriceMarkerStyle = computed(() => {
      if (!range2Min.value) {
        return { left: '0%' }
      }
      const cur = price2Min.value
      const clamped = Math.min(Math.max(cur, minPrice2Min.value), maxPrice2Min.value)
      const pct = ((clamped - minPrice2Min.value) / range2Min.value) * 100
      return { left: pct + '%' }
    })

    // Timeframe completeness (demo)
    const timeFrameCompleteness = computed(() => {
      if (!startTime.value || isDataStale.value) {
        return { thirty: 0, twoMin: 0, fiveMin: 0 }
      }
      const elapsed = Date.now() - startTime.value
      return {
        thirty: Math.min((elapsed / CONSTANTS.THIRTY_SECONDS) * 100, 100),
        twoMin: Math.min((elapsed / CONSTANTS.TWO_MINUTES) * 100, 100),
        fiveMin: Math.min((elapsed / CONSTANTS.FIVE_MINUTES) * 100, 100)
      }
    })

    // Helpers
    function formatNumber(n, type = 'default') {
      if (n === undefined || n === null || isNaN(n)) return '0'
      switch (type) {
        case 'volume':
          return Number(n).toFixed(4)
        case 'price':
          return Number(n).toFixed(2)
        case 'diff':
          return Number(n).toFixed(2)
        default:
          return Number(n).toFixed(2)
      }
    }

    function formatDiff(n) {
      if (!n || isNaN(n)) return '(0)'
      const sign = n > 0 ? '+' : ''
      return sign + n.toFixed(2) + '%'
    }

    function signOf(val) {
      return val > 0 ? '+' : (val < 0 ? '-' : '')
    }

    // Sort exchanges (5m)
    const sortedExchanges5Min = computed(() => {
      const arr = recentSnapshots5Min.value
      const map = new Map()
      arr.forEach(snap => {
        if (!map.has(snap.exchange)) {
          map.set(snap.exchange, {
            name: snap.exchange,
            totalVol: 0,
            sumPV: 0,
            sumV: 0
          })
        }
        const info = map.get(snap.exchange)
        const vol = snap.buy_volume + snap.sell_volume
        info.totalVol += vol
        info.sumPV += snap.buy_volume * snap.buy_avg_price
        info.sumPV += snap.sell_volume * snap.sell_avg_price
        info.sumV += vol
      })

      const basePrice = metrics5Min.value.avgPrice
      const result = []
      map.forEach(info => {
        const price = info.sumV ? (info.sumPV / info.sumV) : 0
        const diff = basePrice ? ((price - basePrice) / basePrice) * 100 : 0
        result.push({
          name: info.name,
          totalVol: info.totalVol,
          price: price,
          diff: diff
        })
      })
      return result.sort((a,b) => b.totalVol - a.totalVol)
    })

    // Compute Buy% for a specific exchange over X seconds
    function exComputed(exchangeName, seconds) {
      const cutoff = Date.now() - seconds * 1000
      const exArr = snapshots.value.filter(s => s.exchange === exchangeName && s.timestamp > cutoff)
      let buy = 0, sell = 0
      exArr.forEach(s => {
        buy += s.buy_volume
        sell += s.sell_volume
      })
      return {
        buyPercent: calcBuyPercent(buy, sell)
      }
    }

    // WebSocket
    const ws = new window.WebSocketService({
      url: 'wss://api.coinybubble.com/ws/btc',
      debug: true,
      onMessage: (msg) => {
        lastMessageTime.value = Date.now()
        if (!startTime.value) {
          startTime.value = Date.now()
        }
        const newItems = Array.isArray(msg) ? msg : [msg]
        const valid = newItems.filter(x => x.exchange && x.timestamp)
        snapshots.value.push(...valid)
        // Keep only 5-min worth of data
        const cut = Date.now() - CONSTANTS.FIVE_MINUTES
        snapshots.value = snapshots.value.filter(s => s.timestamp > cut)
      },
      onConnected: () => {
        wsStatus.value = 'connected'
        snapshots.value = []
        startTime.value = null
        lastMessageTime.value = null
      },
      onDisconnected: () => {
        wsStatus.value = 'disconnected'
      }
    })
    ws.connect()

    return {
      wsStatus,
      isDataStale,

      // 30s metrics
      price30Sec, vwap30Sec, minPrice30Sec, maxPrice30Sec,
      buyVol30Sec, sellVol30Sec,
      volumeDiff30Sec,
      buyPercent30Sec,

      // 2m metrics
      price2Min, vwap2Min, minPrice2Min, maxPrice2Min,
      buyVol2Min, sellVol2Min,
      volumeDiff2Min,
      buyPercent2Min,

      // 5m metrics
      price5Min, vwap5Min, minPrice5Min, maxPrice5Min,
      buyVol5Min, sellVol5Min,
      volumeDiff5Min,
      buyPercent5Min,

      // Pseudo trades
      pseudoTrades,
      buyTradesLimited,
      sellTradesLimited,
      maxVol5Min,
      dynamicStyle,
      getTradeSize,

      // 10s metrics
      tenSecBuy,
      tenSecSell,
      tenSecTrendColor,
      minPrice10Sec,
      maxPrice10Sec,
      slider10SecStyle2Min,

      // White marker for current price (2m)
      currentPriceMarkerStyle,

      // Speedometer
      last10SecTradesCount,
      speedometerArrowStyle,

      // Price difference vs. vwap30Sec
      price2MinDiff30Sec,

      // Time completeness
      timeFrameCompleteness,

      // Exchanges
      sortedExchanges5Min,
      exComputed,

      // Helpers
      formatNumber,
      formatDiff,
      signOf
    }
  }
}).mount('#app')