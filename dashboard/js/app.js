;(function () {
  const qs = (sel) => document.querySelector(sel)

  const defaultFilters = () => {
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - 89)
    return {
      dateFrom: from.toISOString().slice(0, 10),
      dateTo: to.toISOString().slice(0, 10),
      granularity: 'day',
      managerId: '',
      clientId: '',
      productId: ''
    }
  }

  let rawData = null
  let filters = defaultFilters()
  let dataLoadSource = 'demo'

  const parseAmount = (v) => {
    if (v == null || v === '') return 0
    if (typeof v === 'number' && Number.isFinite(v)) return v
    let s = String(v)
      .replace(/[\s\u00a0\u202f\u2007]/g, '')
      .replace(/₸|₽|\$|€|руб\.?|тг\.?|тенге|kzt|usd/gi, '')
    if (s.includes(',') && s.includes('.')) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.')
      else s = s.replace(/,/g, '')
    } else {
      s = s.replace(',', '.')
    }
    const n = parseFloat(s)
    return Number.isFinite(n) ? n : 0
  }

  const decodeCsvText = (buf) => {
    const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf
    const utf = new TextDecoder('utf-8', { fatal: false }).decode(u8)
    if (!/\uFFFD/.test(utf)) return utf
    try {
      return new TextDecoder('windows-1251').decode(u8)
    } catch (e) {
      return utf
    }
  }

  const findHeader = (headers, aliases) => {
    const low = headers.map((h) => String(h || '').trim().toLowerCase())
    for (let i = 0; i < low.length; i++) {
      for (const a of aliases) {
        const al = a.toLowerCase()
        if (low[i] === al || low[i].includes(al)) return i
      }
    }
    return -1
  }

  const cellToISODate = (v) => {
    if (v == null || v === '') return ''
    if (typeof v === 'number' && Number.isFinite(v)) {
      const utc = Math.round((v - 25569) * 86400 * 1000)
      return new Date(utc).toISOString().slice(0, 10)
    }
    const s = String(v).trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10)
    return s.length >= 10 ? s.slice(0, 10) : s
  }

  const kindFromFinanceOp = (val) => {
    const t = String(val || '').trim().toLowerCase()
    if (!t) return null
    if (t.includes('расход') || t.includes('списан')) return 'expense'
    if (t.includes('приход') || t.includes('поступлен')) return 'income'
    if (t === 'р' || t === 'расх') return 'expense'
    if (t === 'п' || t === 'прих') return 'income'
    return null
  }

  const inferMarketingChannel = (label) => {
    const t = String(label || '').trim().toLowerCase()
    if (t.includes('google') || t.includes('ads')) return { channel: 'google', channelLabel: 'Google Ads' }
    if (t.includes('яндекс') || t.includes('yandex')) return { channel: 'yandex', channelLabel: 'Яндекс' }
    if (t.includes('2gis') || t.includes('2гис')) return { channel: '2gis', channelLabel: '2GIS' }
    const lab = String(label || '').trim()
    return { channel: 'import', channelLabel: lab || 'Импорт' }
  }

  const domainLabelRu = (d) =>
    d === 'marketing' ? 'маркетинг' : d === 'finance' ? 'финансы' : 'продажи'

  const applyPreset = (preset) => {
    const to = new Date()
    const from = new Date()
    if (preset === 'day') {
      from.setTime(to.getTime())
    } else if (preset === 'week') {
      from.setDate(to.getDate() - 6)
    } else if (preset === 'month') {
      from.setMonth(to.getMonth() - 1)
    }
    filters.dateFrom = from.toISOString().slice(0, 10)
    filters.dateTo = to.toISOString().slice(0, 10)
    qs('#inp-from').value = filters.dateFrom
    qs('#inp-to').value = filters.dateTo
  }

  const populateSelect = (id, items, placeholder, getValue, getLabel) => {
    const el = document.getElementById(id)
    if (!el) return
    el.innerHTML = ''
    const opt0 = document.createElement('option')
    opt0.value = ''
    opt0.textContent = placeholder
    el.appendChild(opt0)
    items.forEach((item) => {
      const o = document.createElement('option')
      o.value = getValue(item)
      o.textContent = getLabel(item)
      el.appendChild(o)
    })
  }

  const normalizePayload = (data) => {
    if (!data.transactions) data.transactions = []
    if (!data.clients) data.clients = []
    if (!data.products) data.products = []
    if (!data.managers) data.managers = []
    if (!data.plans) data.plans = { daily: [], funnel: {} }
    if (!data.plans.daily) data.plans.daily = []
    if (!data.marketingDaily) data.marketingDaily = []
    if (!data.funnelSnapshots) data.funnelSnapshots = []
    if (!data.funnelStages) data.funnelStages = ['lead', 'contact', 'dialog', 'deal', 'payment']
    if (!data.meta) data.meta = {}
    data.meta.currency = 'KZT'
    if (!data.lossReasons) data.lossReasons = []
    if (!data.cashLedger) data.cashLedger = []
    if (!data.dds) data.dds = []
    if (!data.financePayrollDaily) data.financePayrollDaily = []
    // PROMPT-04: дефолты для планирования продаж
    if (!data.plans.yearly) data.plans.yearly = { orders: 4106, revenue: 101065615, avgCheck: 24612, conversion: 0.529 }
    if (!data.plans.seasonal) data.plans.seasonal = [0.7, 0.75, 0.85, 1.0, 1.1, 1.05, 0.9, 0.85, 1.0, 1.15, 1.2, 1.35]
    return data
  }

  const loadData = async () => {
    const tryFetch = async (url, label) => {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) return false
      const json = await res.json()
      rawData = normalizePayload(json)
      dataLoadSource = label
      return true
    }
    try {
      if (await tryFetch('data/dashboard-data.json', 'dashboard-data.json')) return
      if (await tryFetch('data/sample-data.json', 'sample-data.json')) return
    } catch (e) {
      /* use demo */
    }
    rawData = normalizePayload(window.DashboardDemo.generateDemoData())
    dataLoadSource = 'demo'
  }

  const parseTransactionsFromSheet = (rows) => {
    const headers = rows[0].map((h) => String(h || '').trim())
    const dateCol = findHeader(headers, ['date', 'дата'])
    const clientCol = findHeader(headers, ['clientid', 'клиент', 'client'])
    const mgrCol = findHeader(headers, ['managerid', 'менеджер', 'manager'])
    const prodCol = findHeader(headers, ['productid', 'продукт', 'product', 'услуга'])
    const amountCol = findHeader(headers, ['amount', 'сумма'])
    const planCol = findHeader(headers, ['planamount', 'план', 'plan'])
    const statusCol = findHeader(headers, ['status', 'статус'])
    const funnelCol = findHeader(headers, ['funnelstage', 'этап', 'воронка'])
    const sourceCol = findHeader(headers, ['source', 'источник'])
    const segmentCol = findHeader(headers, ['segment', 'сегмент'])
    const orderAmountCol = findHeader(headers, ['orderamount', 'сумма заказа', 'order amount'])
    const areaSqmCol = findHeader(headers, ['areasqm', 'площадь', 'кв.м', 'area', 'sqm'])
    const rejectionCol = findHeader(headers, ['rejectionreason', 'причина отказа', 'причина'])
    const callbackCol = findHeader(headers, ['iscallback', 'перезвон', 'callback'])
    if (dateCol < 0 || amountCol < 0) {
      throw new Error('Нужны колонки date и amount (или дата и сумма)')
    }
    const transactions = []
    const clientsMap = new Map()
    const productsMap = new Map()
    const managersMap = new Map()
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]
      if (!row || !row[dateCol]) continue
      const date = cellToISODate(row[dateCol])
      const clientRaw = clientCol >= 0 ? String(row[clientCol] || 'client').trim() : 'client'
      const mgrRaw = mgrCol >= 0 ? String(row[mgrCol] || 'mgr').trim() : 'mgr'
      const prodRaw = prodCol >= 0 ? String(row[prodCol] || 'prd').trim() : 'prd'
      const cid = `c-${clientRaw}`
      const mid = `m-${mgrRaw}`
      const pid = `p-${prodRaw}`
      let seg = 'B2C'
      if (segmentCol >= 0 && row[segmentCol]) {
        const s = String(row[segmentCol]).trim().toUpperCase()
        if (s.includes('B2B')) seg = 'B2B'
        if (s.includes('B2C')) seg = 'B2C'
      }
      if (!clientsMap.has(cid)) clientsMap.set(cid, { id: cid, name: clientRaw, segment: seg, registeredAt: date })
      if (!managersMap.has(mid)) managersMap.set(mid, { id: mid, name: mgrRaw })
      if (!productsMap.has(pid)) productsMap.set(pid, { id: pid, name: prodRaw })
      const amount = parseAmount(row[amountCol])
      const planAmount = planCol >= 0 ? parseAmount(row[planCol]) : 0
      const status = statusCol >= 0 ? String(row[statusCol] || 'paid').toLowerCase() : 'paid'
      const funnelStage = funnelCol >= 0 ? String(row[funnelCol] || 'payment').toLowerCase() : 'payment'
      const source = sourceCol >= 0 ? String(row[sourceCol] || 'import') : 'import'
      const orderAmount = orderAmountCol >= 0 ? parseAmount(row[orderAmountCol]) : amount
      const areaSqm = areaSqmCol >= 0 ? parseAmount(row[areaSqmCol]) : 0
      const rejectionReason = rejectionCol >= 0 ? String(row[rejectionCol] || '') : ''
      const isCallback = callbackCol >= 0 ? String(row[callbackCol] || '').toLowerCase() === 'да' : false
      transactions.push({
        id: `trx-${r}`,
        date,
        clientId: cid,
        managerId: mid,
        productId: pid,
        amount,
        planAmount,
        status: ['paid', 'unpaid', 'lost'].includes(status) ? status : 'paid',
        funnelStage: ['lead', 'contact', 'dialog', 'deal', 'payment'].includes(funnelStage) ? funnelStage : 'payment',
        source,
        orderAmount,
        areaSqm,
        rejectionReason,
        isCallback
      })
    }
    return normalizePayload({
      meta: { currency: 'KZT', source: 'xlsx', importDomain: 'sales' },
      clients: [...clientsMap.values()],
      managers: [...managersMap.values()],
      products: [...productsMap.values()],
      transactions,
      plans: { daily: [], funnel: {} },
      marketingDaily: [],
      funnelSnapshots: []
    })
  }

  const parseMarketingFromSheet = (rows) => {
    const pickHeaderRow = () => {
      for (let hix = 0; hix < Math.min(8, rows.length); hix++) {
        const headers = rows[hix].map((h) => String(h || '').trim())
        const dateCol = findHeader(headers, ['дата', 'date', 'день'])
        const spendCol = findHeader(headers, ['расход', 'списан', 'spend', 'cost', 'бюджет'])
        const clicksCol = findHeader(headers, ['клики', 'clicks', 'визиты', 'visits'])
        const leadsCol = findHeader(headers, ['лиды', 'leads'])
        if (dateCol >= 0 && (spendCol >= 0 || clicksCol >= 0 || leadsCol >= 0)) {
          return {
            hi: hix,
            dateCol,
            spendCol,
            clicksCol,
            leadsCol,
            channelCol: findHeader(headers, ['канал', 'channel', 'источник', 'площадка']),
            impCol: findHeader(headers, ['показы', 'impressions', 'показ'])
          }
        }
      }
      return null
    }
    const ph = pickHeaderRow()
    if (!ph) {
      throw new Error(
        'Маркетинг: в первых строках нужны дата и хотя бы одна колонка из: расход, клики/визиты, лиды'
      )
    }
    const { hi, dateCol, spendCol, clicksCol, leadsCol, channelCol, impCol } = ph
    const marketingDaily = []
    for (let r = hi + 1; r < rows.length; r++) {
      const row = rows[r]
      if (!row || row[dateCol] == null || String(row[dateCol]).trim() === '') continue
      const date = cellToISODate(row[dateCol])
      if (!date || date.length < 10) continue
      const ch = inferMarketingChannel(channelCol >= 0 ? row[channelCol] : '')
      const spend = spendCol >= 0 ? parseAmount(row[spendCol]) : 0
      const clicks = clicksCol >= 0 ? parseAmount(row[clicksCol]) : 0
      const leads = leadsCol >= 0 ? parseAmount(row[leadsCol]) : 0
      const impressions = impCol >= 0 ? parseAmount(row[impCol]) : 0
      marketingDaily.push({
        date,
        channel: ch.channel,
        channelLabel: ch.channelLabel,
        spend,
        spendCurrency: 'KZT',
        impressions: impressions || 0,
        clicks: clicks || 0,
        leads: leads || 0,
        contactsAfterSale: 0,
        applicationsOut: 0
      })
    }
    if (!marketingDaily.length) {
      throw new Error('Маркетинг: нет строк с валидной датой')
    }
    const ds = marketingDaily.map((m) => m.date).sort()
    return normalizePayload({
      meta: {
        currency: 'KZT',
        source: 'upload',
        importDomain: 'marketing',
        sourceRanges: { marketingDaily: { min: ds[0], max: ds[ds.length - 1] } }
      },
      clients: [],
      managers: [],
      products: [],
      transactions: [],
      plans: { daily: [], funnel: {} },
      marketingDaily,
      funnelSnapshots: []
    })
  }

  const parseFinanceLedgerFromSheet = (rows) => {
    let hi = -1
    let dateCol = -1
    let opCol = -1
    let amountCol = -1
    let catCol = -1
    let artCol = -1
    let payCol = -1
    for (let cand = 0; cand < Math.min(12, rows.length); cand++) {
      const headers = rows[cand].map((h) => String(h || '').trim())
      const d = findHeader(headers, ['дата', 'date', 'день'])
      const o = findHeader(headers, ['тип операции', 'вид операции', 'типоперации', 'операция'])
      const a = findHeader(headers, ['сумма', 'amount'])
      if (d >= 0 && o >= 0 && a >= 0) {
        hi = cand
        dateCol = d
        opCol = o
        amountCol = a
        catCol = findHeader(headers, ['категория', 'category'])
        artCol = findHeader(headers, ['статья', 'article', 'назначение платежа', 'назначение'])
        payCol = findHeader(headers, ['тип оплаты', 'вид оплаты', 'payment'])
        break
      }
    }
    if (hi < 0) {
      throw new Error(
        'Финансы: не найдены заголовки дата + тип операции + сумма (смотрите первые 12 строк файла)'
      )
    }
    const cashLedger = []
    for (let r = hi + 1; r < rows.length; r++) {
      const row = rows[r]
      if (!row || row[dateCol] == null || String(row[dateCol]).trim() === '') continue
      const date = cellToISODate(row[dateCol])
      if (!date || date.length < 10) continue
      const kind = kindFromFinanceOp(row[opCol])
      if (!kind) continue
      const amount = parseAmount(row[amountCol])
      if (!amount) continue
      let category = 'Без категории'
      if (catCol >= 0 && row[catCol] != null && String(row[catCol]).trim()) {
        category = String(row[catCol]).trim()
      }
      const rec = { date, kind, amount, category }
      if (artCol >= 0 && row[artCol] != null && String(row[artCol]).trim()) {
        rec.article = String(row[artCol]).trim()
      }
      if (payCol >= 0 && row[payCol] != null && String(row[payCol]).trim()) {
        rec.paymentType = String(row[payCol]).trim()
      }
      cashLedger.push(rec)
    }
    if (!cashLedger.length) {
      throw new Error('Финансы: нет строк с Приходом/Расходом и ненулевой суммой')
    }
    const ds = cashLedger.map((x) => x.date).sort()
    return normalizePayload({
      meta: {
        currency: 'KZT',
        source: 'upload',
        importDomain: 'finance',
        sourceRanges: { cashLedger: { min: ds[0], max: ds[ds.length - 1] } }
      },
      clients: [],
      managers: [],
      products: [],
      transactions: [],
      plans: { daily: [], funnel: {} },
      marketingDaily: [],
      funnelSnapshots: [],
      cashLedger
    })
  }

  const handleFile = (file) => {
    const name = (file && file.name) || ''
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const domImp = qs('#sel-import-domain')
        const importDomain = domImp && domImp.value ? domImp.value : 'sales'
        if (name.endsWith('.json')) {
          const json = JSON.parse(e.target.result)
          rawData = normalizePayload(json)
          dataLoadSource = 'upload:json'
        } else if (name.endsWith('.csv')) {
          const text = decodeCsvText(e.target.result)
          const lines = text.split(/\r?\n/).filter(Boolean)
          const rows = lines.map((line) => {
            const split = []
            let cur = ''
            let q = false
            for (let i = 0; i < line.length; i++) {
              const ch = line[i]
              if (ch === '"') q = !q
              else if ((ch === ';' || ch === ',') && !q) {
                split.push(cur.replace(/^"|"$/g, ''))
                cur = ''
              } else cur += ch
            }
            split.push(cur.replace(/^"|"$/g, ''))
            return split
          })
          if (importDomain === 'marketing') rawData = parseMarketingFromSheet(rows)
          else if (importDomain === 'finance') rawData = parseFinanceLedgerFromSheet(rows)
          else rawData = parseTransactionsFromSheet(rows)
          dataLoadSource = `upload:csv:${importDomain}`
        } else if (window.XLSX) {
          const wb = window.XLSX.read(e.target.result, { type: 'binary' })
          const sheet = wb.Sheets[wb.SheetNames[0]]
          const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1 })
          if (importDomain === 'marketing') rawData = parseMarketingFromSheet(rows)
          else if (importDomain === 'finance') rawData = parseFinanceLedgerFromSheet(rows)
          else rawData = parseTransactionsFromSheet(rows)
          dataLoadSource = `upload:xlsx:${importDomain}`
        } else {
          alert('Для XLSX подключите SheetJS (см. index.html)')
          return
        }
        refreshSelects()
        run()
        const st = document.getElementById('data-status')
        if (st) {
          const dl = name.endsWith('.json') ? 'JSON (полный снимок)' : domainLabelRu(importDomain)
          st.textContent = `Загружено: ${name} · маппер: ${dl}`
        }
      } catch (err) {
        alert(err.message || String(err))
      }
    }
    if (name.endsWith('.json')) reader.readAsText(file, 'UTF-8')
    else if (name.endsWith('.csv')) reader.readAsArrayBuffer(file)
    else reader.readAsBinaryString(file)
  }

  const applyDateRangeFromMeta = () => {
    if (!rawData || !rawData.meta || !rawData.meta.sourceRanges) return
    const sr = rawData.meta.sourceRanges
    const blocks = ['marketingDaily', 'transactions', 'plansDaily', 'cashLedger', 'dds']
    let minD = null
    let maxD = null
    for (const k of blocks) {
      const b = sr[k]
      if (!b || !b.min || !b.max) continue
      let a = String(b.min).trim()
      let z = String(b.max).trim()
      if (k === 'dds') {
        if (a.length === 7) a = `${a}-01`
        if (z.length === 7) {
          const [yy, mm] = z.split('-').map(Number)
          const last = new Date(yy, mm, 0).getDate()
          z = `${z}-${String(last).padStart(2, '0')}`
        }
      }
      a = a.slice(0, 10)
      z = z.slice(0, 10)
      if (!minD || a < minD) minD = a
      if (!maxD || z > maxD) maxD = z
    }
    if (minD && maxD) {
      filters.dateFrom = minD
      filters.dateTo = maxD
      const fi = qs('#inp-from')
      const ti = qs('#inp-to')
      if (fi) fi.value = minD
      if (ti) ti.value = maxD
    }
  }

  const refreshSelects = () => {
    if (!rawData) return
    populateSelect('sel-manager', rawData.managers, 'Все менеджеры', (x) => x.id, (x) => x.name)
    populateSelect('sel-client', rawData.clients, 'Все клиенты', (x) => x.id, (x) => x.name)
    populateSelect('sel-product', rawData.products, 'Все продукты', (x) => x.id, (x) => x.name)
    qs('#sel-manager').value = filters.managerId
    qs('#sel-client').value = filters.clientId
    qs('#sel-product').value = filters.productId
  }

  const readFiltersFromDom = () => {
    filters.dateFrom = qs('#inp-from').value
    filters.dateTo = qs('#inp-to').value
    filters.granularity = qs('#sel-granularity').value
    filters.managerId = qs('#sel-manager').value
    filters.clientId = qs('#sel-client').value
    filters.productId = qs('#sel-product').value
  }

  const run = () => {
    if (!rawData) return
    readFiltersFromDom()
    const result = window.DashboardAnalytics.compute(rawData, filters)
    window.DashboardUI.renderAll(rawData, result, filters, {
      onDrillClient: (clientId) => {
        filters.clientId = clientId
        qs('#sel-client').value = clientId
        run()
      }
    })
  }

  const init = async () => {
    await loadData()
    if (!qs('#inp-from')) return  // legacy UI not in DOM (new sidebar layout)
    applyDateRangeFromMeta()
    qs('#inp-from').value = filters.dateFrom
    qs('#inp-to').value = filters.dateTo
    qs('#sel-granularity').value = filters.granularity
    refreshSelects()

    ;['#inp-from', '#inp-to', '#sel-granularity', '#sel-manager', '#sel-client', '#sel-product'].forEach((sel) => {
      const el = qs(sel)
      if (el) el.addEventListener('change', run)
    })
    ;['#btn-preset-day', '#btn-preset-week', '#btn-preset-month'].forEach((id, i) => {
      const el = qs(id)
      if (el)
        el.addEventListener('click', () => {
          applyPreset(['day', 'week', 'month'][i])
          run()
        })
    })
    const fileInput = qs('#file-data')
    if (fileInput) {
      fileInput.addEventListener('change', (ev) => {
        const f = ev.target.files && ev.target.files[0]
        if (f) handleFile(f)
      })
    }
    const statusEl = document.getElementById('data-status')
    if (statusEl) {
      const hint = {
        demo: 'Источник: демо (KZT). Для своих данных: data/dashboard-data.json или data/sample-data.json, либо загрузка CSV/XLSX.',
        'dashboard-data.json': 'Источник: data/dashboard-data.json (KZT)',
        'sample-data.json': 'Источник: data/sample-data.json (KZT)'
      }
      let msg = hint[dataLoadSource] || `Источник: ${dataLoadSource} (KZT)`
      const meta = rawData && rawData.meta
      const note = meta && meta.salesNote
      if (note) {
        const short = note.length > 160 ? `${note.slice(0, 160)}…` : note
        msg = `${msg} — ${short}`
      } else if (meta && meta.salesPivotSynthesized) {
        msg = `${msg} — Выручка из сводного отчёта (группы × день), не построчные сделки CRM.`
      }
      if (meta && meta.financeMonthSheets && meta.financeMonthSheets.length) {
        msg = `${msg} План: листы ${meta.financeMonthSheets.join(', ')}.`
      }
      if (meta && meta.warnings && meta.warnings.length) {
        msg = `${msg} Предупреждений: ${meta.warnings.length}.`
      }
      statusEl.textContent = msg
    }
    run()

    // Модуль себестоимости — независим от фильтров, инициализируется один раз
    if (window.DaraCostModel && window.DashboardUI.renderCostModel) {
      const costResult = window.DaraCostModel.computeAll()
      window.DashboardUI.renderCostModel(costResult)
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
