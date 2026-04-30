;(function (global) {
  'use strict'

  const MAP_KEY = 'ba9c5d28-9cb8-4c35-8eb3-9023496ba786'
  const ALMATY_CENTER = [76.889709, 43.238293]
  const ALMATY_ZOOM = 11

  let mapInstance = null
  let heatmapLayer = null
  let markersArr = []
  let allData = null       // все адреса из JSON
  let filteredData = null  // после фильтров
  let mapReady = false
  let currentMode = 'heatmap'

  // ——— Определение района ТОЛЬКО по координатам ———
  // Проверяем в порядке приоритета (if-chain, без перекрытий)
  // Границы выверены по карте 2GIS с подписями районов
  function detectDistrict(lat, lng) {
    // Медеуский — восток и горы (lng > 76.935)
    if (lng >= 76.935 && lat >= 43.185 && lat <= 43.340) return 'Медеуский'

    // Турксибский — северо-восток (lat > 43.320, lng > 76.950)
    if (lat >= 43.320 && lng >= 76.950) return 'Турксибский'

    // Жетысуский — север от центра (lat 43.295–43.450, lng 76.835–76.950)
    if (lat >= 43.295 && lat <= 43.460 && lng >= 76.835 && lng <= 76.955) return 'Жетысуский'

    // Алмалинский — исторический центр (lat 43.240–43.298, lng 76.845–76.940)
    if (lat >= 43.240 && lat <= 43.298 && lng >= 76.845 && lng <= 76.940) return 'Алмалинский'

    // Бостандыкский — юго-запад центра (lat 43.170–43.268, lng 76.795–76.900)
    if (lat >= 43.170 && lat <= 43.268 && lng >= 76.795 && lng <= 76.905) return 'Бостандыкский'

    // Ауэзовский — запад (lat 43.165–43.285, lng 76.705–76.860)
    if (lat >= 43.165 && lat <= 43.285 && lng >= 76.705 && lng <= 76.860) return 'Ауэзовский'

    // Алатауский — северо-запад (lat 43.215–43.430, lng 76.640–76.845)
    if (lat >= 43.215 && lat <= 43.430 && lng >= 76.640 && lng <= 76.845) return 'Алатауский'

    // Наурызбайский — дальний запад (lat 43.140–43.310, lng 76.550–76.730)
    if (lat >= 43.140 && lat <= 43.310 && lng >= 76.550 && lng <= 76.730) return 'Наурызбайский'

    return 'Пригород'
  }

  function enrichData(data) {
    return data.map(p => ({ ...p, district: detectDistrict(p.lat, p.lng) }))
  }

  // ——— Фильтрация ———
  function applyFilters() {
    const district = document.getElementById('heatmap-district')?.value || ''
    const fromVal = parseInt(document.getElementById('heatmap-orders-from')?.value || 1)
    const toVal   = parseInt(document.getElementById('heatmap-orders-to')?.value   || 9999)
    const search  = (document.getElementById('heatmap-search')?.value || '').toLowerCase().trim()

    // Обновляем подпись
    const minLbl = document.getElementById('heatmap-min-val')
    const maxLbl = document.getElementById('heatmap-max-val')
    if (minLbl) minLbl.textContent = fromVal
    if (maxLbl) maxLbl.textContent = toVal

    filteredData = allData.filter(p => {
      if (district && p.district !== district) return false
      if (p.orders < fromVal || p.orders > toVal) return false
      if (search && !p.address.toLowerCase().includes(search)) return false
      return true
    })

    updateMap()
    renderDistrictStats(filteredData)
    updateCountLabel()
  }

  function updateCountLabel() {
    const el = document.getElementById('heatmap-count-label')
    if (!el) return
    const total = allData.length
    const shown = filteredData.length
    const orders = filteredData.reduce((s, p) => s + (p.orders || 1), 0)
    el.textContent = shown === total
      ? `${shown.toLocaleString('ru-RU')} адресов · ${orders.toLocaleString('ru-RU')} заказов`
      : `Показано ${shown.toLocaleString('ru-RU')} из ${total.toLocaleString('ru-RU')} адресов · ${orders.toLocaleString('ru-RU')} заказов`
  }

  // ——— Статистика по районам ———
  function renderDistrictStats(data) {
    const el = document.getElementById('heatmap-district-stats')
    if (!el) return

    const byDistrict = {}
    for (const p of data) {
      const d = p.district || 'Пригород'
      if (!byDistrict[d]) byDistrict[d] = { addresses: 0, orders: 0 }
      byDistrict[d].addresses++
      byDistrict[d].orders += (p.orders || 1)
    }

    const totalOrders = data.reduce((s, p) => s + (p.orders || 1), 0)
    const sorted = Object.entries(byDistrict).sort((a, b) => b[1].orders - a[1].orders)

    const selectedDistrict = document.getElementById('heatmap-district')?.value || ''

    el.innerHTML = sorted.map(([name, stat]) => {
      const pct = totalOrders > 0 ? Math.round(stat.orders / totalOrders * 100) : 0
      const isActive = selectedDistrict === name
      return `
        <div class="district-row${isActive ? ' district-row--active' : ''}"
          data-district="${name}"
          style="padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:4px;
                 background:${isActive ? '#EEF2FF' : 'transparent'};
                 border:1px solid ${isActive ? '#6366F1' : 'transparent'};
                 transition:background .15s">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
            <span style="font-weight:600;font-size:13px;color:${isActive ? '#4F46E5' : '#111827'}">${name}</span>
            <span style="font-size:12px;font-weight:700;color:#6366F1">${stat.orders.toLocaleString('ru-RU')} зак.</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="height:4px;flex:1;background:#F3F4F6;border-radius:2px;margin-right:8px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:#6366F1;border-radius:2px"></div>
            </div>
            <span style="font-size:11px;color:#6B7280;white-space:nowrap">${pct}% · ${stat.addresses} адр.</span>
          </div>
        </div>`
    }).join('')

    // Клик по строке — устанавливает фильтр района
    el.querySelectorAll('.district-row').forEach(row => {
      row.addEventListener('click', () => {
        const sel = document.getElementById('heatmap-district')
        const d = row.dataset.district
        if (sel) {
          sel.value = (sel.value === d) ? '' : d  // повторный клик — сброс
          applyFilters()
        }
      })
    })
  }

  // ——— KPI вверху страницы ———
  function renderStats(data) {
    const el = document.getElementById('heatmap-stats')
    if (!el) return

    const totalOrders = data.reduce((s, d) => s + (d.orders || 1), 0)
    const maxOrders = Math.max(...data.map(d => d.orders || 1))
    const topAddress = data.find(d => d.orders === maxOrders)
    const districts = new Set(data.map(d => d.district)).size

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
        <div class="kpi-card__label">Районов охвачено</div>
        <div class="kpi-card__value">${districts}</div>
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

  // ——— Цвет точки ———
  function makeDotIcon(size, r, g, b, opacity) {
    const c = size / 2
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${c}" cy="${c}" r="${c-1}" fill="rgba(${r},${g},${b},${opacity})" stroke="rgba(255,255,255,0.6)" stroke-width="0.5"/></svg>`
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
  }

  function heatColor(ratio) {
    const stops = [[0,0,255],[0,200,255],[0,230,50],[255,210,0],[255,30,0]]
    const idx = ratio * (stops.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.min(lo + 1, stops.length - 1)
    const t = idx - lo
    return stops[lo].map((v, i) => Math.round(v + (stops[hi][i] - v) * t))
  }

  // ——— Очистка слоёв ———
  function clearLayers() {
    if (heatmapLayer) { try { heatmapLayer.destroy() } catch {} heatmapLayer = null }
    markersArr.forEach(m => { try { m.destroy() } catch {} })
    markersArr = []
    const old = document.getElementById('heatmap-canvas')
    if (old) old.remove()
  }

  // ——— Режим точек ———
  function showDots(data) {
    clearLayers()
    const items = [...data].sort((a, b) => (b.orders||1) - (a.orders||1)).slice(0, 3000)
    const maxO = items[0]?.orders || 1

    for (const p of items) {
      const ratio = Math.min(1, Math.log1p(p.orders||1) / Math.log1p(maxO))
      const [r, g, b] = heatColor(ratio)
      const size = Math.round(8 + ratio * 14)
      const opacity = 0.6 + ratio * 0.35

      try {
        const icon = makeDotIcon(size, r, g, b, opacity)
        const m = new mapgl.Marker(mapInstance, {
          coordinates: [p.lng, p.lat], icon, anchor: [0.5, 0.5]
        })
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
      } catch {
        try {
          markersArr.push(new mapgl.Marker(mapInstance, { coordinates: [p.lng, p.lat] }))
        } catch {}
      }
    }
  }

  // ——— Canvas тепловая карта ———
  function lngLatToPixel(lng, lat) {
    if (!mapInstance?.project) return null
    try { return mapInstance.project([lng, lat]) } catch { return null }
  }

  function renderHeatCanvas(canvas, data) {
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
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

  function drawHeatmapCanvas(data) {
    const mapEl = document.getElementById('heatmap-map')
    if (!mapEl || !mapInstance) return
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

  function bindMapMove(data) {
    if (!mapInstance?.on) return
    const redraw = () => {
      const canvas = document.getElementById('heatmap-canvas')
      if (canvas) renderHeatCanvas(canvas, data)
    }
    mapInstance.on('move', redraw)
    mapInstance.on('zoom', redraw)
    mapInstance.on('moveend', redraw)
  }

  function showHeatmap(data) {
    clearLayers()
    if (typeof mapgl !== 'undefined' && typeof mapgl.HeatMap === 'function') {
      try {
        heatmapLayer = new mapgl.HeatMap(mapInstance, {
          data: {
            type: 'FeatureCollection',
            features: data.map(p => ({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
              properties: { weight: Math.log1p(p.orders || 1) }
            }))
          },
          radius: 25, opacity: 0.85,
          gradient: {
            '0.0': 'rgba(0,0,255,0)', '0.25': 'rgba(0,200,255,0.55)',
            '0.5': 'rgba(0,230,50,0.7)', '0.75': 'rgba(255,210,0,0.85)',
            '1.0': 'rgba(255,30,0,1)'
          }
        })
        return
      } catch {}
    }
    if (mapInstance?.project) {
      try { drawHeatmapCanvas(data); bindMapMove(data); return } catch {}
    }
    showDots(data)
  }

  // ——— Обновить карту при смене фильтров ———
  function updateMap() {
    if (!mapReady || !filteredData) return
    if (currentMode === 'heatmap') showHeatmap(filteredData)
    else showDots(filteredData)
  }

  // ——— Переключатель режима ———
  function setMode(mode) {
    currentMode = mode
    document.querySelectorAll('.heatmap-mode-btn').forEach(btn => {
      btn.classList.toggle('heatmap-mode-btn--active', btn.dataset.mode === mode)
    })
    updateMap()
  }

  // ——— Инициализация карты ———
  function initMap(data) {
    const container = document.getElementById('heatmap-map')
    if (!container || typeof mapgl === 'undefined') return

    try {
      mapInstance = new mapgl.Map('heatmap-map', {
        center: ALMATY_CENTER, zoom: ALMATY_ZOOM, key: MAP_KEY, trafficControl: false
      })
    } catch (e) {
      container.innerHTML = `<div style="padding:32px;color:#EF4444;font-size:14px">Ошибка карты: ${e.message}</div>`
      return
    }

    mapReady = true
    let rendered = false
    const renderOnce = () => {
      if (rendered) return
      rendered = true
      filteredData = data
      updateMap()
      updateCountLabel()
    }
    if (typeof mapInstance.on === 'function') mapInstance.on('load', renderOnce)
    setTimeout(renderOnce, 800)
  }

  // ——— Настройка фильтров ———
  function setupFilters() {
    document.getElementById('heatmap-district')?.addEventListener('change', applyFilters)

    let searchTimer
    document.getElementById('heatmap-search')?.addEventListener('input', () => {
      clearTimeout(searchTimer)
      searchTimer = setTimeout(applyFilters, 300)
    })

    document.getElementById('heatmap-orders-from')?.addEventListener('change', applyFilters)
    document.getElementById('heatmap-orders-to')?.addEventListener('change', applyFilters)

    document.getElementById('heatmap-reset')?.addEventListener('click', () => {
      const el = (id) => document.getElementById(id)
      if (el('heatmap-district'))    el('heatmap-district').value = ''
      if (el('heatmap-orders-from')) el('heatmap-orders-from').value = 1
      if (el('heatmap-orders-to'))   el('heatmap-orders-to').value = el('heatmap-orders-to').max || 16
      if (el('heatmap-search'))      el('heatmap-search').value = ''
      applyFilters()
    })

    document.querySelectorAll('.heatmap-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode))
    })
  }

  // ——— Загрузка данных ———
  async function loadData() {
    try {
      const res = await fetch('data/geocoded-addresses.json')
      if (!res.ok) return null
      return await res.json()
    } catch { return null }
  }

  // ——— Главная функция ———
  async function render() {
    const loading = document.getElementById('heatmap-loading')
    const content = document.getElementById('heatmap-content')

    if (mapReady) {
      if (loading) loading.style.display = 'none'
      if (content) content.style.display = 'block'
      return
    }

    const raw = await loadData()
    if (loading) loading.style.display = 'none'
    if (content) content.style.display = 'block'

    if (!raw || raw.length === 0) {
      const mapEl = document.getElementById('heatmap-map')
      if (mapEl) mapEl.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:#6B7280;font-size:14px;padding:32px"><div style="font-size:48px">🗺️</div><div>Геоданные не найдены. Запустите geocode-2gis-v2.js</div></div>`
      return
    }

    allData = enrichData(raw)
    filteredData = allData

    renderStats(allData)
    renderDistrictStats(allData)
    setupFilters()

    // Устанавливаем max у полей диапазона
    const maxO = Math.max(...allData.map(d => d.orders || 1))
    const fromEl = document.getElementById('heatmap-orders-from')
    const toEl   = document.getElementById('heatmap-orders-to')
    const maxLbl = document.getElementById('heatmap-max-val')
    if (fromEl) { fromEl.max = maxO }
    if (toEl)   { toEl.max = maxO; toEl.value = maxO }
    if (maxLbl) maxLbl.textContent = maxO

    if (typeof mapgl === 'undefined') {
      const script = document.createElement('script')
      script.src = 'https://mapgl.2gis.com/api/js/v1'
      script.onload = () => initMap(filteredData)
      script.onerror = () => {
        const mapEl = document.getElementById('heatmap-map')
        if (mapEl) mapEl.innerHTML = '<div style="padding:32px;color:#9CA3AF">Не удалось загрузить SDK 2GIS.</div>'
      }
      document.head.appendChild(script)
    } else {
      initMap(filteredData)
    }
  }

  global.HeatmapDashboard = { render }
})(window)
