/* eslint-disable no-unused-vars */
/**
 * Детерминированная генерация демо-данных для офлайн-режима (file://)
 */
;(function (global) {
  const createRng = (seed) => {
    let s = seed >>> 0
    return () => {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0
      return s / 4294967296
    }
  }

  const addDays = (iso, n) => {
    const d = new Date(iso + 'T12:00:00')
    d.setDate(d.getDate() + n)
    return d.toISOString().slice(0, 10)
  }

  const monthKey = (iso) => iso.slice(0, 7)

  const funnelStages = ['lead', 'contact', 'dialog', 'deal', 'payment']
  const rejectionReasons = ['Дорого', 'Минималка', 'Пропал', 'Далеко', 'Долго', 'Другое']

  const generateDemoData = (seed = 20250324) => {
    const rng = createRng(seed)
    const managers = [
      { id: 'mgr-1', name: 'Анна Смирнова' },
      { id: 'mgr-2', name: 'Игорь Волков' },
      { id: 'mgr-3', name: 'Мария Орлова' }
    ]
    const products = [
      { id: 'prd-1', name: 'Химчистка ковров' },
      { id: 'prd-2', name: 'Мебель / диваны' },
      { id: 'prd-3', name: 'Авто / салон' },
      { id: 'prd-4', name: 'Абонемент B2B' },
      { id: 'prd-5', name: 'Срочный выезд' }
    ]
    const clientNames = [
      'ООО Чистота',
      'ИП Петров',
      'ЖК Солнечный',
      'Кафе Уют',
      'Салон Авто',
      'Частный заказ #12',
      'ТЦ Галерея',
      'Офис Техно',
      'Клиника Здоровье',
      'Детсад Радуга'
    ]
    const sources = ['Google', '2GIS', 'Яндекс.Директ', 'Сарафан', 'Повтор']
    const segments = ['B2B', 'B2C']

    const clients = []
    for (let i = 0; i < 48; i++) {
      const seg = segments[i % 2]
      const reg = addDays('2024-06-01', Math.floor(rng() * 200))
      clients.push({
        id: `cli-${i + 1}`,
        name: `${clientNames[i % clientNames.length]}${i > 9 ? ` (${i})` : ''}`,
        segment: seg,
        registeredAt: reg
      })
    }

    const transactions = []
    let tid = 1
    const start = '2025-01-01'
    const days = 420
    for (let day = 0; day < days; day++) {
      const date = addDays(start, day)
      const orders = 2 + Math.floor(rng() * 5)
      for (let o = 0; o < orders; o++) {
        const client = clients[Math.floor(rng() * clients.length)]
        const manager = managers[Math.floor(rng() * managers.length)]
        const product = products[Math.floor(rng() * products.length)]
        const base = 3000 + rng() * 18000
        const amount = Math.round(base / 100) * 100
        const planAmount = Math.round((amount * (0.85 + rng() * 0.35)) / 100) * 100
        const roll = rng()
        let status = 'paid'
        if (roll < 0.06) status = 'unpaid'
        else if (roll < 0.09) status = 'lost'
        const stageRoll = rng()
        let funnelStage = 'payment'
        if (status === 'lost') {
          funnelStage = ['lead', 'contact', 'dialog', 'deal'][Math.floor(rng() * 4)]
        } else if (status === 'unpaid') {
          funnelStage = rng() < 0.5 ? 'deal' : 'dialog'
        } else if (stageRoll < 0.05) funnelStage = 'lead'
        else if (stageRoll < 0.12) funnelStage = 'contact'
        else if (stageRoll < 0.22) funnelStage = 'dialog'
        else if (stageRoll < 0.35) funnelStage = 'deal'
        else funnelStage = 'payment'

        const areaSqm = Math.round((5 + rng() * 45) * 10) / 10
        const orderAmount = status === 'paid' || status === 'unpaid' ? amount : 0
        const rejReason = status === 'lost' ? rejectionReasons[Math.floor(rng() * rejectionReasons.length)] : ''
        const isCallback = rng() < 0.15

        transactions.push({
          id: `trx-${tid++}`,
          date,
          clientId: client.id,
          managerId: manager.id,
          productId: product.id,
          amount,
          planAmount,
          status,
          funnelStage,
          source: sources[Math.floor(rng() * sources.length)],
          orderAmount,
          areaSqm,
          rejectionReason: rejReason,
          isCallback
        })
      }
    }

    const dailyPlan = {}
    for (let day = 0; day < days; day++) {
      const date = addDays(start, day)
      dailyPlan[date] = Math.round((45000 + rng() * 25000) / 1000) * 1000
    }

    const marketingDaily = []
    const channels = [
      { id: 'google', label: 'Google Ads' },
      { id: 'yandex', label: 'Яндекс.Директ' },
      { id: '2gis', label: '2GIS' },
      { id: 'organic', label: 'Органика / CRM' }
    ]
    for (let day = 0; day < days; day++) {
      const date = addDays(start, day)
      channels.forEach((ch) => {
        const spend = Math.round((500 + rng() * 4500) / 10) * 10
        const impressions = Math.round(spend * (20 + rng() * 40))
        const clicks = Math.round(impressions * (0.02 + rng() * 0.05))
        const leads = Math.max(1, Math.round(clicks * (0.08 + rng() * 0.2)))
        const contactsAfterSale = Math.round(rng() * 4)
        const applicationsOut = Math.round(rng() * 3)
        marketingDaily.push({
          date,
          channel: ch.id,
          channelLabel: ch.label,
          spend,
          impressions,
          clicks,
          leads,
          contactsAfterSale,
          applicationsOut
        })
      })
    }

    const funnelSnapshots = []
    for (let day = 0; day < days; day++) {
      const date = addDays(start, day)
      let lead = 80 + Math.floor(rng() * 60)
      let contact = Math.round(lead * (0.55 + rng() * 0.15))
      let dialog = Math.round(contact * (0.5 + rng() * 0.15))
      let deal = Math.round(dialog * (0.45 + rng() * 0.15))
      let payment = Math.round(deal * (0.55 + rng() * 0.2))
      funnelSnapshots.push({ date, lead, contact, dialog, deal, payment })
    }

    const plans = {
      funnel: {
        lead: funnelSnapshots.reduce((s, x) => s + x.lead, 0) / funnelSnapshots.length * 30,
        contact: 0,
        dialog: 0,
        deal: 0,
        payment: 0
      },
      funnelDailyFactor: 1
    }
    const avg = (k) => funnelSnapshots.reduce((s, x) => s + x[k], 0) / funnelSnapshots.length
    plans.funnel.contact = avg('contact') * 30
    plans.funnel.dialog = avg('dialog') * 30
    plans.funnel.deal = avg('deal') * 30
    plans.funnel.payment = avg('payment') * 30

    const lossReasons = [
      { reason: 'Дорого / бюджет', amount: 180000, count: 12 },
      { reason: 'Ушли к конкуренту', amount: 120000, count: 9 },
      { reason: 'Не дозвонились', amount: 65000, count: 22 },
      { reason: 'Сроки не подошли', amount: 40000, count: 7 }
    ]

    return {
      meta: { currency: 'KZT', generatedAt: new Date().toISOString(), source: 'demo' },
      managers,
      products,
      clients,
      transactions,
      plans: {
        daily: Object.keys(dailyPlan).map((date) => ({ date, amount: dailyPlan[date] })),
        funnel: plans.funnel,
        yearly: {
          orders: 4106,
          revenue: 101065615,
          avgCheck: 24612,
          conversion: 0.529,
          newClientsShare: 0.776
        },
        seasonal: [0.7, 0.75, 0.85, 1.0, 1.1, 1.05, 0.9, 0.85, 1.0, 1.15, 1.2, 1.35]
      },
      marketingDaily,
      funnelSnapshots,
      funnelStages,
      lossReasons
    }
  }

  global.DashboardDemo = { generateDemoData }
})(typeof window !== 'undefined' ? window : globalThis)
