;(function (global) {
  'use strict'

  const MAP_KEY = 'ba9c5d28-9cb8-4c35-8eb3-9023496ba786'
  const ALMATY_CENTER = [76.889709, 43.238293]
  const ALMATY_ZOOM = 11

  let mapInstance = null
  let heatmapLayer = null
  let markersArr = []
  let allData = null
  let mapReady = false
  let currentMode = 'heatmap' // 'heatmap' | 'dots'

  // ——— Загрузка геоданных ———
  async function loadData() {
    try {
      const res = await fetch('data/geocoded-addresses.json')
      if (!res.ok) return null
      return await res.json()
    } catch (e) {
      return null
    }
  }

  // ——— Статистика ———
  function renderStats(data) {
    const el = document.getElementById('heatmap-stats')
    if (!el) return

    const totalOrders = data.reduce((s, d) => s + (d.orders || 1), 0)
    const maxOrders = Math.max(...data.map(d => d.orders || 1))
    const topAddress = data.find(d => d.orders === maxOrders)

    el.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-card__label">Адресов на карте</div>
        <div class="kpi-card__value">${data.length.toLocaleString('ru-RU')}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__label">Всего заказов</div>
        <div class="kpi-card__value">${totalOrders.toLocaleString('ru-RU')}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__label">Макс. заказов (1 адрес)</div>
        <div class="kpi-card__value">${maxOrders}</div>
      </div>
      ${topAddress ? `
      <div class="kpi-card" style="grid-column:span 2">
        <div class="kpi-card__label">Самый активный адрес</div>
        <div class="kpi-card__value" style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${topAddress.address}</div>
      </div>` : ''}
    `
  }

  // ——— Создать SVG-иконку точки ———
  function makeDotIcon(size, r, g, b, opacity) {
    const s = size
    const c = s / 2
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><circle cx="${c}" cy="${c}" r="${c-1}" fill="rgba(${r},${g},${b},${opacity})" stroke="rgba(255,255,255,0.6)" stroke-width="0.5"/></svg>`
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
  }

  // ——— Интерполяция цвета: синий→циан→зелёный→жёлтый→красный ———
  function heatColor(ratio) {
    // 0→синий, 0.25→циан, 0.5→зелёный, 0.75→жёлтый, 1→красный
    const stops = [
      [0, 0, 255],    // синий
      [0, 200, 255],  // циан
      [0, 230, 50],   // зелёный
      [255, 210, 0],  // жёлтый
      [255, 30, 0],   // красный
    ]
    const idx = ratio * (stops.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.min(lo + 1, stops.length - 1)
    const t = idx - lo
    return stops[lo].map((v, i) => Math.round(v + (stops[hi][i] - v) * t))
  }

  // ——— Очистить все слои ———
  function clearLayers() {
    if (heatmapLayer) {
      try { heatmapLayer.destroy() } catch (e) {}
      heatmapLayer = null
    }
    markersArr.forEach(m => { try { m.destroy() } catch (e) {} })
    markersArr = []
  }

  // ——— Режим точек ———
  function showDots(data) {
    clearLayers()
    // Топ 2500 по заказам
    const items = [...data].sort((a, b) => (b.orders||1) - (a.orders||1)).slice(0, 2500)
    const maxO = items[0]?.orders || 1

    for (const p of items) {
      const ratio = Math.min(1, Math.log1p(p.orders||1) / Math.log1p(maxO))
      const [r, g, b] = heatColor(ratio)
      const size = Math.round(8 + ratio * 14)
      const opacity = 0.6 + ratio * 0.35

      try {
        const icon = makeDotIcon(size, r, g, b, opacity)
        const m = new mapgl.Marker(mapInstance, {
          coordinates: [p.lng, p.lat],
          icon,
          anchor: [0.5, 0.5]
        })
        // Тултип при наведении
        m.on('mouseover', () => {
          const tip = document.getElementById('heatmap-tooltip')
          if (tip) {
            tip.textContent = `${p.address} — ${p.orders} зак.`
            tip.style.display = 'block'
          }
        })
        m.on('mouseout', () => {
          const tip = document.getElementById('heatmap-tooltip')
          if (tip) tip.style.display = 'none'
        })
        markersArr.push(m)
      } catch (e) {
        // Запасной вариант без иконки
        try {
          const m = new mapgl.Marker(mapInstance, { coordinates: [p.lng, p.lat] })
          markersArr.push(m)
        } catch (e2) {}
      }
    }
    document.getElementById('heatmap-count-label').textContent =
      `Показано ${items.length.toLocaleString('ru-RU')} из ${data.length.toLocaleString('ru-RU')} адресов`
  }

  // ——— Тепловая карта через Canvas ———
  function drawHeatmapCanvas(data) {
    const mapEl = document.getElementById('heatmap-map')
    if (!mapEl || !mapInstance) return

    // Удаляем старый canvas если есть
    const old = document.getElementById('heatmap-canvas')
    if (old) old.remove()

    const canvas = document.createElement('canvas')
    canvas.id = 'heatmap-canvas'
    canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:1'
    canvas.width = mapEl.clientWidth
    canvas.height = mapEl.clientHeight
    mapEl.style.position = 'relative'
    mapEl.appendChild(canvas)

    renderHeatCanvas(canvas, data)
    heatmapLayer = { destroy: () => { const c = document.getElementById('heatmap-canvas'); if(c) c.remove() } }
  }

  function lngLatToPixel(lng, lat) {
    if (!mapInstance || !mapInstance.project) return null
    try {
      return mapInstance.project([lng, lat])
    } catch(e) {
      return null
    }
  }

  function renderHeatCanvas(canvas, data) {
    const ctx = canvas.getContext('2d')
    const W = canvas.width
    const H = canvas.height
    ctx.clearRect(0, 0, W, H)

    const RADIUS = 28
    const maxO = Math.max(...data.map(d => d.orders || 1))

    for (const p of data) {
      const pt = lngLatToPixel(p.lng, p.lat)
      if (!pt || pt[0] < -RADIUS || pt[0] > W + RADIUS || pt[1] < -RADIUS || pt[1] > H + RADIUS) continue

      const ratio = Math.min(1, Math.log1p(p.orders||1) / Math.log1p(maxO))
      const [r, g, b] = heatColor(ratio)
      const alpha = 0.15 + ratio * 0.45

      const grad = ctx.createRadialGradient(pt[0], pt[1], 0, pt[0], pt[1], RADIUS)
      grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`)
      grad.addColorStop(1, 'rgba(0,0,0,0)')

      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(pt[0], pt[1], RADIUS, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // ——— Обновить canvas при движении карты ———
  function bindMapMove(data) {
    if (!mapInstance || typeof mapInstance.on !== 'function') return
    const redraw = () => {
      const canvas = document.getElementById('heatmap-canvas')
      if (canvas) renderHeatCanvas(canvas, data)
    }
    mapInstance.on('move', redraw)
    mapInstance.on('zoom', redraw)
    mapInstance.on('moveend', redraw)
  }

  // ——— Режим тепловой карты ———
  function showHeatmap(data) {
    clearLayers()

    // Попытка 1: нативный mapgl.HeatMap
    if (typeof mapgl !== 'undefined' && typeof mapgl.HeatMap === 'function') {
      try {
        const features = data.map(p => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          properties: { weight: Math.log1p(p.orders || 1) }
        }))
        heatmapLayer = new mapgl.HeatMap(mapInstance, {
          data: { type: 'FeatureCollection', features },
          radius: 25,
          opacity: 0.85,
          gradient: {
            '0.0': 'rgba(0,0,255,0)',
            '0.25': 'rgba(0,200,255,0.55)',
            '0.5': 'rgba(0,230,50,0.7)',
            '0.75': 'rgba(255,210,0,0.85)',
            '1.0': 'rgba(255,30,0,1)'
          }
        })
        document.getElementById('heatmap-count-label').textContent =
          `${data.length.toLocaleString('ru-RU')} адресов · тепловая карта`
        return
      } catch (e) {
        console.warn('mapgl.HeatMap failed:', e)
      }
    }

    // Попытка 2: Canvas overlay
    if (mapInstance && mapInstance.project) {
      try {
        drawHeatmapCanvas(data)
        bindMapMove(data)
        document.getElementById('heatmap-count-label').textContent =
          `${data.length.toLocaleString('ru-RU')} адресов · тепловая карта`
        return
      } catch (e) {
        console.warn('Canvas heatmap failed:', e)
      }
    }

    // Fallback: точки
    showDots(data)
  }

  // ——— Переключатель режима ———
  function setMode(mode) {
    currentMode = mode
    document.querySelectorAll('.heatmap-mode-btn').forEach(btn => {
      btn.classList.toggle('heatmap-mode-btn--active', btn.dataset.mode === mode)
    })
    if (!allData) return
    if (mode === 'heatmap') {
      showHeatmap(allData)
    } else {
      showDots(allData)
    }
  }

  // ——— Инициализация карты ———
  function initMap(data) {
    const container = document.getElementById('heatmap-map')
    if (!container || typeof mapgl === 'undefined') return

    try {
      mapInstance = new mapgl.Map('heatmap-map', {
        center: ALMATY_CENTER,
        zoom: ALMATY_ZOOM,
        key: MAP_KEY,
        // Отключаем 3D тайлы для более быстрой загрузки
        trafficControl: false
      })
    } catch (e) {
      container.innerHTML = `<div style="padding:32px;color:#EF4444;font-size:14px">
        Ошибка инициализации карты: ${e.message}</div>`
      return
    }

    allData = data
    mapReady = true

    // 2GIS MapGL инициализируется синхронно, рендерим через небольшую задержку
    const doRender = () => {
      if (currentMode === 'heatmap') showHeatmap(data)
      else showDots(data)
    }

    // Слушаем load если есть, плюс safety timeout
    let rendered = false
    const renderOnce = () => {
      if (rendered) return
      rendered = true
      doRender()
    }

    if (typeof mapInstance.on === 'function') {
      mapInstance.on('load', renderOnce)
    }
    // Гарантированный рендер через 800мс если 'load' не сработал
    setTimeout(renderOnce, 800)
  }

  // ——— Показ заглушки ———
  function showNoData() {
    const mapEl = document.getElementById('heatmap-map')
    if (!mapEl) return
    mapEl.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:#6B7280;font-size:14px;padding:32px">
        <div style="font-size:48px">🗺️</div>
        <div style="font-weight:600;color:#374151">Геоданные не найдены</div>
        <div>Запустите скрипт из папки <code>Dara Clean</code>:</div>
        <code style="background:#F3F4F6;padding:8px 16px;border-radius:6px;font-size:12px">node scripts/generate-demo.js</code>
        <div style="font-size:12px;color:#9CA3AF;text-align:center;max-width:420px">
          Генерирует приближённые координаты по районам Алматы.
          Для точных координат нужен 2GIS Geocoding API ключ.
        </div>
      </div>
    `
  }

  // ——— Главная функция ———
  async function render() {
    const loading = document.getElementById('heatmap-loading')
    const content = document.getElementById('heatmap-content')

    // Карта уже инициализирована — просто показываем
    if (mapReady) {
      if (loading) loading.style.display = 'none'
      if (content) content.style.display = 'block'
      return
    }

    const data = await loadData()

    if (loading) loading.style.display = 'none'
    if (content) content.style.display = 'block'

    if (!data || data.length === 0) {
      showNoData()
      return
    }

    renderStats(data)
    setupModeButtons()

    // Динамически загружаем mapgl SDK
    if (typeof mapgl === 'undefined') {
      const script = document.createElement('script')
      script.src = 'https://mapgl.2gis.com/api/js/v1'
      script.onload = () => initMap(data)
      script.onerror = () => {
        const mapEl = document.getElementById('heatmap-map')
        if (mapEl) mapEl.innerHTML =
          '<div style="padding:32px;color:#9CA3AF;font-size:14px">Не удалось загрузить SDK карты 2GIS. Проверьте интернет-соединение.</div>'
      }
      document.head.appendChild(script)
    } else {
      initMap(data)
    }
  }

  function setupModeButtons() {
    document.querySelectorAll('.heatmap-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode))
    })
  }

  global.HeatmapDashboard = { render }
})(window)
