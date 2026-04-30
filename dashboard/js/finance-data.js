;(function (global) {
  'use strict'

  // ─── МЕСЯЧНЫЙ ФАКТ 2025 (из PROMPT-03) ───────────────────────────────────
  // Источник истины: помесячная таблица из PROMPT-03-FINANCIAL-PLAN.md
  // Используется как fallback когда DDS JSON неполный (только сент-дек)
  const FACT_2025_MONTHLY = {
    labels:    ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'],
    revenue:   [4066009, 5073529, 5936965, 7752958, 9441972, 11231195, 11139195, 7512538, 13387344, 8950309, 10010031, 15103879],
    opExpense: [4800945, 6461293, 5906695, 7433458, 9050417, 8993280, 10543545, 8181640, 12274287, 8735309, 8453341, 7458730],
    withdrawal:[706750,  938235,  670420,  1264995, 1577280, 1718350, 1784117, 1275250, 2168100, 1805310, 1547300, 1288000],
    // кумулятивный дефицит — рассчитывается при загрузке
    cumulative: null
  }

  // Предвычисляем кумулятивный дефицит
  ;(function () {
    let cum = 0
    FACT_2025_MONTHLY.cumulative = FACT_2025_MONTHLY.revenue.map((rev, i) => {
      const balance = rev - FACT_2025_MONTHLY.opExpense[i] - FACT_2025_MONTHLY.withdrawal[i]
      cum += balance
      return cum
    })
  })()

  // ─── ДОХОДЫ 2025 (из Excel: Доходы = Услуги + Фин.операции + Пополнение) ──
  const INCOME_2025_MONTHLY = {
    services:   [4066009, 5073529, 5936965, 7752958, 9441972, 11231195, 11139195, 7512538, 13387344, 8950309, 10010031, 15103879],
    finOps:     [0, 0, 0, 0, 0, 0, 0, 0, 5000, 0, 0, 0],
    topUp:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 8535309, 0, 0]
  }
  // Помесячный итого доходов
  // total = services (уже включает все поступления), finOps и topUp отдельно для аналитики
  INCOME_2025_MONTHLY.total = INCOME_2025_MONTHLY.services.slice()
  // Итого поступлений = сумма services (без повторного суммирования topUp/finOps)
  const INCOME_2025_TOTAL = INCOME_2025_MONTHLY.services.reduce((s, v) => s + v, 0) // 109,605,924

  // Итого 2025
  const TOTALS_2025 = {
    revenue:    101_065_615,
    totalCogs:   96_825_783,
    grossProfit:  4_239_832,
    withdrawals: 16_744_107,
    margin:       0.042,
    peakDeficit: -11_797_662,
    peakMonth:   'Октябрь',
    yearEndDeficit: -5_431_123,
    totalIncome: INCOME_2025_TOTAL
  }

  // ─── МАППИНГ СТАТЕЙ ДДС → 6 БЛОКОВ СЕБЕСТОИМОСТИ ─────────────────────────
  // Источник: PROMPT-02-COST-UNIT-ECONOMICS.md + реальные имена из dashboard-data.json
  const EXPENSE_TO_BLOCK = {
    // ПРОИЗВОДСТВО (68.6%)
    'ФОТ оклад ЦЕХ':                     'production',
    'ФОТ_1':                              '__subtotal',  // агрегатная строка: сумма ФОТ оклад ЦЕХ + больничный + аутсорс + бонусы
    'ФОТ больничный':                     'production',
    'ФОТ аутсорс':                        'production',
    'Аванс':                              'production',
    'Бонусы':                             'production',
    'Документы рабочим':                  'production',
    'Шампунь для ковров':                 'production',
    'Химия для чистки':                   'production',
    'Химия для цеха':                     'production',
    'Хоз.рас материалы_1':               'production',  // агрегатная строка
    'Пакеты':                             'production',
    'Скотч':                              'production',
    'Бирки':                              'production',
    'Скобы':                              'production',
    'Накладные':                          'production',
    'Хозбыт':                             'production',
    'Инструменты':                        'production',
    'Бытовые':                            'production',
    'Содержание цеха':                    'production',
    'Приобретение для цеха':              'production',
    'Оборудование (обновление)':          'production',
    'Оборудование (тех.обслуживание)':   'production',
    'Поставщик':                          'production',  // расходники
    'Поставщик_1':                        'production',  // коммунальные
    'Свет':                               'production',
    'Газ':                                'production',
    'Вода':                               'production',
    'Продукты цех':                       'production',
    'Приобретение для кухни цеха':        'production',
    'Септик':                             'production',
    'Вывоз мусора':                       'production',
    'Оплата услуг штор и тюлей':          'production',
    'Ремонт ковров':                      'production',
    'Аренда Агбиса':                      'production',

    // ЛОГИСТИКА (8.5%)
    'ФОТ оклад Логистика':                'logistics',
    'Обед водителям':                     'logistics',
    'Приобретение для курьеров':          'logistics',
    'Абонент трекер':                     'logistics',
    'ГСМ':                                'logistics',
    'Мойка':                              'logistics',
    'Запчасти':                           'logistics',
    'Замена шин/Вулканизация':            'logistics',
    'Ремонт ходовой части':               'logistics',
    'Ремонт двигителя и коробки':         'logistics',
    'Транспортные расходы':               '__subtotal',  // агрегатная строка: сумма ГСМ + Запчасти + Ремонт + др.
    'Транспортные расходы_1':             '__subtotal',  // агрегатная строка: доп. транспортные
    'Ремонт':                             'logistics',
    'Замена масла':                       'logistics',
    'Замена колодок':                     'logistics',
    'Штрафы':                             'logistics',
    'Техосмотр':                          'logistics',
    'Страховка':                          'logistics',
    'Прочее расходы':                     'logistics',
    'Такси/доставка':                     'logistics',

    // МАРКЕТИНГ (17.3%)
    'Маркетинг_1':                        '__subtotal',  // агрегатная строка: сумма Google + 2Гис + Yandex
    'Покупка рекламы Google':             'marketing',
    'Покупка рекламы 2Гис':               'marketing',
    'Покупка рекламы Yandex':             'marketing',
    'Покупка рекламы Instagram':          'marketing',
    'Покупка рекламы TikTok':             'marketing',
    'Наружняя реклама':                   'marketing',
    'Подписка сайта':                     'marketing',
    'Купоны и баннеры':                   'marketing',
    'Бартер/Блогер':                      'marketing',
    'СММ':                                'marketing',
    'Констектолог':                       'marketing',
    'Таргетолог':                         'marketing',
    'Обзвон':                             'marketing',
    'Оплата модели':                      'marketing',
    'Видеограф':                          'marketing',
    'Бюджет на съемки':                   'marketing',
    'Реклама мебели':                     'marketing',

    // ПРОДАЖИ (0.7%)
    'ФОТ оклад Отел продаж':              'sales',
    'Телефония Кар Тел':                  'sales',
    'Wazzup подписка':                    'sales',
    'Приобретение для отдела продаж':     'sales',
    'Канцелярия':                         'sales',

    // НАЛОГИ (3.2%)
    'Налоги_1':                           'taxes',
    'Тариф':                              'taxes',  // банковский тариф = налоговая нагрузка

    // ОПЕРАЦИОННЫЕ (1.7%)
    'Интернет':                           'overhead',
    'Подписка Битрикс':                   'overhead',
    'Бухгалтер':                          'overhead',
    'Содержание офиса':                   'overhead',
    'Услиги юриста':                      'overhead',
    'Услуги типографии':                  'overhead',
    'Тимбилдинг':                         'overhead',
    'Покупка консультации':               'overhead',
    'Обьяление для сотрудников':          'overhead',
    'Единоразовый расход (приобретение)': 'overhead',
    'Прочие расходы':                     'overhead',
    'Покупка ковра':                      'overhead',
    'Услуга аренды машины':               'overhead',

    // ИСКЛЮЧЕНЫ: выводы средств собственника
    'Вывод средств':                      '__withdrawal',
    'Kaspi Pay':                          '__withdrawal',
    'Наличными':                          '__withdrawal',
    'ФОТ Собственник':                    '__owner',

    // ИСКЛЮЧЕНЫ: финансовые операции
    'Финансовые операции':                '__financial',
    'Погашение займа':                    '__financial',
    'Погашение кредита':                  '__financial',
  }

  const BLOCK_META = {
    production: { label: 'Производство',  color: '#8B5CF6', icon: '🏭', factTotal: 66_443_421, sharePct: 68.6 },
    logistics:  { label: 'Логистика',     color: '#F59E0B', icon: '🚚', factTotal:  8_223_434, sharePct:  8.5 },
    marketing:  { label: 'Маркетинг',     color: '#3B82F6', icon: '📢', factTotal: 16_795_722, sharePct: 17.3 },
    sales:      { label: 'Продажи',       color: '#10B981', icon: '💬', factTotal:    685_872, sharePct:  0.7 },
    taxes:      { label: 'Налоги',        color: '#6B7280', icon: '📋', factTotal:  3_060_143, sharePct:  3.2 },
    overhead:   { label: 'Операционные',  color: '#EC4899', icon: '⚙️', factTotal:  1_617_191, sharePct:  1.7 },
  }

  const BLOCK_KEYS = ['production', 'logistics', 'marketing', 'sales', 'taxes', 'overhead']

  const MONTHS_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

  // ─── ВСПОМОГАТЕЛЬНЫЕ ─────────────────────────────────────────────────────
  function classifyRow(name) {
    const block = EXPENSE_TO_BLOCK[name]
    if (block) return block
    // Поиск по подстроке для неизвестных строк
    const n = name.toLowerCase()
    if (n.includes('фот') || n.includes('зп') || n.includes('зарплата')) return 'production'
    if (n.includes('гсм') || n.includes('транспорт') || n.includes('бензин')) return 'logistics'
    if (n.includes('реклама') || n.includes('маркетинг') || n.includes('google') || n.includes('2гис')) return 'marketing'
    if (n.includes('налог') || n.includes('пенс') || n.includes('соц')) return 'taxes'
    return 'overhead'  // fallback
  }

  // Является ли DDS 2025 полным (содержит все 12 месяцев с реальными данными)?
  function isDdsComplete(dds, year) {
    const entry = dds && dds.find(d => d.year === year)
    if (!entry || !entry.incomeItogo) return false
    const total = entry.incomeItogo.total || 0
    return total > 80_000_000  // если меньше 80M — данные неполные
  }

  // ─── ИЗВЛЕЧЕНИЕ ДАННЫХ ИЗ DDS ────────────────────────────────────────────

  /**
   * Возвращает помесячные данные для года.
   * Если DDS неполный — возвращает FACT_2025_MONTHLY fallback.
   * @param {Array} dds
   * @param {number} year
   * @returns {{ labels, revenue, opExpense, withdrawal, cumulative, fromFallback }}
   */
  function getMonthlyData(dds, year) {
    if (year === 2025 && !isDdsComplete(dds, 2025)) {
      return { ...FACT_2025_MONTHLY, fromFallback: true }
    }

    const entry = dds && dds.find(d => d.year === year)
    if (!entry) return { ...FACT_2025_MONTHLY, fromFallback: true }

    const revenue = new Array(12).fill(0)
    const blockTotals = {}
    BLOCK_KEYS.forEach(k => { blockTotals[k] = new Array(12).fill(0) })
    const withdrawal = new Array(12).fill(0)

    // Собираем income по месяцам
    ;(entry.incomeRows || []).forEach(row => {
      const byMonth = row.byMonth || {}
      const vals = row.values || []
      MONTHS_SHORT.forEach((_, i) => {
        const monthKey = Object.keys(byMonth)[i]
        const v = monthKey ? (byMonth[monthKey] || 0) : (vals[i] || 0)
        // Только "услуги" — реальная выручка
        if (row.name && (row.name.toLowerCase().includes('услуг') || row.name.toLowerCase().includes('чистка') || row.name.toLowerCase().includes('хим'))) {
          revenue[i] += v
        } else if (row.name && (row.name.toLowerCase().includes('пополнени') || row.name.toLowerCase().includes('kaspi') || row.name.toLowerCase().includes('наличными'))) {
          revenue[i] += v
        }
      })
    })

    // Собираем расходы по месяцам
    ;(entry.expenseRows || []).forEach(row => {
      const block = classifyRow(row.name || '')
      const byMonth = row.byMonth || {}
      const vals = row.values || []
      MONTHS_SHORT.forEach((_, i) => {
        const monthKey = Object.keys(byMonth)[i]
        const v = monthKey ? (byMonth[monthKey] || 0) : (vals[i] || 0)
        if (block === '__withdrawal') {
          withdrawal[i] += v
        } else if (!block.startsWith('__') && blockTotals[block]) {
          blockTotals[block][i] += v
        }
      })
    })

    // Если income пустой — пробуем incomeItogo.byMonth
    const hasRevenue = revenue.some(v => v > 0)
    if (!hasRevenue && entry.incomeItogo && entry.incomeItogo.byMonth) {
      Object.entries(entry.incomeItogo.byMonth).forEach(([key, val]) => {
        const idx = MONTHS_SHORT.findIndex((m, i) => {
          const monthNum = i + 1
          return key.endsWith(`-${String(monthNum).padStart(2,'0')}`) || key.includes(m.toLowerCase())
        })
        if (idx >= 0) revenue[idx] = val
      })
    }

    const opExpense = BLOCK_KEYS.reduce((arr, k) => {
      return arr.map((v, i) => v + (blockTotals[k][i] || 0))
    }, new Array(12).fill(0))

    let cum = 0
    const cumulative = revenue.map((rev, i) => {
      cum += rev - opExpense[i] - withdrawal[i]
      return cum
    })

    return { labels: MONTHS_SHORT, revenue, opExpense, withdrawal, cumulative, blockTotals, fromFallback: false }
  }

  /**
   * Суммарные данные по блокам за год.
   * Возвращает { production, logistics, marketing, sales, taxes, overhead } — итого за год
   */
  function getCostBlockTotals(dds, year) {
    // Для 2025 всегда используем BLOCK_META — DDS содержит строки-агрегаты (ФОТ_1, Маркетинг_1 и др.)
    // которые дублируют детальные строки и завышают итог в 2 раза
    if (year === 2025) {
      const totals = {}
      BLOCK_KEYS.forEach(k => { totals[k] = BLOCK_META[k].factTotal })
      return totals
    }

    const entry = dds && dds.find(d => d.year === year)
    if (!entry) {
      const totals = {}
      BLOCK_KEYS.forEach(k => { totals[k] = BLOCK_META[k].factTotal })
      return totals
    }

    const totals = {}
    BLOCK_KEYS.forEach(k => { totals[k] = 0 })

    ;(entry.expenseRows || []).forEach(row => {
      const block = classifyRow(row.name || '')
      if (!block.startsWith('__') && totals[block] !== undefined) {
        totals[block] += (row.total || 0)
      }
    })

    // Если все нули — используем факт
    const hasData = Object.values(totals).some(v => v > 0)
    if (!hasData) {
      BLOCK_KEYS.forEach(k => { totals[k] = BLOCK_META[k].factTotal })
    }

    return totals
  }

  /**
   * Помесячные данные по каждому блоку себестоимости.
   * @returns { production: [12], logistics: [12], ... }
   */
  function getMonthlyByBlock(dds, year) {
    const result = {}
    BLOCK_KEYS.forEach(k => { result[k] = new Array(12).fill(0) })

    if (year === 2025 && !isDdsComplete(dds, 2025)) {
      // Распределяем FACT_2025_MONTHLY.opExpense по блокам пропорционально факту
      const totalCogs = BLOCK_KEYS.reduce((s, k) => s + BLOCK_META[k].factTotal, 0)
      BLOCK_KEYS.forEach(k => {
        const share = BLOCK_META[k].factTotal / totalCogs
        result[k] = FACT_2025_MONTHLY.opExpense.map(v => Math.round(v * share))
      })
      return result
    }

    const entry = dds && dds.find(d => d.year === year)
    if (!entry) return result

    ;(entry.expenseRows || []).forEach(row => {
      const block = classifyRow(row.name || '')
      if (!block.startsWith('__') && result[block]) {
        const byMonth = row.byMonth || {}
        const vals = row.values || []
        MONTHS_SHORT.forEach((_, i) => {
          const monthKey = Object.keys(byMonth)[i]
          const v = monthKey ? (byMonth[monthKey] || 0) : (vals[i] || 0)
          result[block][i] += v
        })
      }
    })

    return result
  }

  /**
   * Строит иерархическое дерево статей для tree-table.
   * @returns Array of { id, label, total, block, monthlyValues, children[] }
   */
  function getCostTree(dds, year) {
    const useFactData = year === 2025 && !isDdsComplete(dds, 2025)

    // Субкатегории внутри блоков
    const SUB_CATEGORIES = {
      production: ['ФОТ цех', 'Материалы', 'Коммунальные', 'Поставщик'],
      logistics:  ['Транспорт ТО', 'ФОТ логистика'],
      marketing:  ['Платная реклама', 'Прочий маркетинг'],
      sales:      ['ФОТ продажи', 'CRM и связь'],
      taxes:      ['Налоги'],
      overhead:   ['Операционные'],
    }

    const SUB_CATEGORY_MAP = {
      'ФОТ оклад ЦЕХ': 'ФОТ цех', 'Аванс': 'ФОТ цех',
      'ФОТ больничный': 'ФОТ цех', 'ФОТ аутсорс': 'ФОТ цех', 'Бонусы': 'ФОТ цех', 'Документы рабочим': 'ФОТ цех',
      'Шампунь для ковров': 'Материалы', 'Химия для чистки': 'Материалы', 'Химия для цеха': 'Материалы',
      'Хоз.рас материалы_1': 'Материалы', 'Пакеты': 'Материалы', 'Скотч': 'Материалы',
      'Бирки': 'Материалы', 'Скобы': 'Материалы', 'Накладные': 'Материалы',
      'Хозбыт': 'Материалы', 'Инструменты': 'Материалы', 'Бытовые': 'Материалы',
      'Оборудование (обновление)': 'Материалы', 'Оборудование (тех.обслуживание)': 'Материалы',
      'Содержание цеха': 'Материалы', 'Приобретение для цеха': 'Материалы',
      'Ремонт ковров': 'Материалы', 'Оплата услуг штор и тюлей': 'Материалы',
      'Свет': 'Коммунальные', 'Газ': 'Коммунальные', 'Вода': 'Коммунальные',
      'Септик': 'Коммунальные', 'Вывоз мусора': 'Коммунальные',
      'Продукты цех': 'Коммунальные', 'Приобретение для кухни цеха': 'Коммунальные',
      'Поставщик': 'Поставщик', 'Поставщик_1': 'Поставщик', 'Аренда Агбиса': 'Поставщик',
      'ГСМ': 'Транспорт ТО', 'Мойка': 'Транспорт ТО', 'Запчасти': 'Транспорт ТО',
      'Замена шин/Вулканизация': 'Транспорт ТО', 'Ремонт ходовой части': 'Транспорт ТО',
      'Ремонт двигителя и коробки': 'Транспорт ТО',
      'Ремонт': 'Транспорт ТО',
      'Замена масла': 'Транспорт ТО', 'Замена колодок': 'Транспорт ТО',
      'Штрафы': 'Транспорт ТО', 'Техосмотр': 'Транспорт ТО', 'Страховка': 'Транспорт ТО',
      'Прочее расходы': 'Транспорт ТО', 'Такси/доставка': 'Транспорт ТО', 'Абонент трекер': 'Транспорт ТО',
      'ФОТ оклад Логистика': 'ФОТ логистика', 'Обед водителям': 'ФОТ логистика',
      'Приобретение для курьеров': 'ФОТ логистика',
      'Покупка рекламы Google': 'Платная реклама',
      'Покупка рекламы 2Гис': 'Платная реклама', 'Покупка рекламы Yandex': 'Платная реклама',
      'Покупка рекламы Instagram': 'Платная реклама', 'Покупка рекламы TikTok': 'Платная реклама',
      'Наружняя реклама': 'Прочий маркетинг', 'Подписка сайта': 'Прочий маркетинг',
      'Купоны и баннеры': 'Прочий маркетинг', 'Бартер/Блогер': 'Прочий маркетинг',
      'СММ': 'Прочий маркетинг', 'Констектолог': 'Прочий маркетинг',
      'Таргетолог': 'Прочий маркетинг', 'Обзвон': 'Прочий маркетинг',
      'Оплата модели': 'Прочий маркетинг', 'Видеограф': 'Прочий маркетинг',
      'Бюджет на съемки': 'Прочий маркетинг', 'Реклама мебели': 'Прочий маркетинг',
      'ФОТ оклад Отел продаж': 'ФОТ продажи',
      'Телефония Кар Тел': 'CRM и связь', 'Wazzup подписка': 'CRM и связь',
      'Приобретение для отдела продаж': 'CRM и связь', 'Канцелярия': 'CRM и связь',
      'Налоги_1': 'Налоги', 'Тариф': 'Налоги',
    }

    // Всегда загружаем entry — expense rows содержат реальные данные даже при неполном income
    const entry = dds && dds.find(d => d.year === year)

    // Строим дерево
    const tree = BLOCK_KEYS.map(blockKey => {
      const meta = BLOCK_META[blockKey]
      const subCatNames = SUB_CATEGORIES[blockKey] || []

      // Сабкатегории: { label → { total, rows: [{ name, total, values }] } }
      const subCats = {}
      subCatNames.forEach(sc => { subCats[sc] = { total: 0, rows: [] } })

      // Заполняем из DDS или используем пустые
      if (entry) {
        ;(entry.expenseRows || []).forEach(row => {
          if (classifyRow(row.name) !== blockKey) return
          const sc = SUB_CATEGORY_MAP[row.name] || subCatNames[0]
          if (!subCats[sc]) subCats[sc] = { total: 0, rows: [] }
          const total = row.total || 0
          if (total === 0) return
          subCats[sc].total += total
          subCats[sc].rows.push({ name: row.name, total })
        })
      }

      // Если нет DDS данных — используем оценочные доли подкатегорий от факта
      const subCatsSum = Object.values(subCats).reduce((s, sc) => s + sc.total, 0)
      if (subCatsSum === 0 && meta.factTotal > 0) {
        const FALLBACK_SHARES = {
          production: { 'ФОТ цех': 0.475, 'Материалы': 0.069, 'Коммунальные': 0.040, 'Поставщик': 0.110 },
          logistics:  { 'Транспорт ТО': 0.81, 'ФОТ логистика': 0.19 },
          marketing:  { 'Платная реклама': 0.92, 'Прочий маркетинг': 0.08 },
          sales:      { 'CRM и связь': 0.63, 'ФОТ продажи': 0.01 },
          taxes:      { 'Налоги': 1.0 },
          overhead:   { 'Операционные': 1.0 },
        }
        const shares = FALLBACK_SHARES[blockKey] || {}
        subCatNames.forEach(sc => {
          const share = shares[sc] || (1 / subCatNames.length)
          subCats[sc].total = Math.round(meta.factTotal * share)
        })
      }

      const blockTotal = subCatsSum > 0 ? subCatsSum : meta.factTotal

      const children = subCatNames
        .filter(sc => subCats[sc] && subCats[sc].total > 0)
        .map(sc => {
          const cat = subCats[sc]
          const catTotal = cat.total
          return {
            id: `${blockKey}-${sc}`,
            label: sc,
            total: catTotal,
            block: blockKey,
            children: cat.rows.map(r => ({
              id: `${blockKey}-${sc}-${r.name}`,
              label: r.name,
              total: r.total,
              block: blockKey,
              children: []
            })).sort((a, b) => b.total - a.total)
          }
        })
        .sort((a, b) => b.total - a.total)

      return {
        id: blockKey,
        label: meta.label.toUpperCase(),
        total: blockTotal,
        sharePct: meta.sharePct,
        block: blockKey,
        color: meta.color,
        children
      }
    })

    return tree
  }

  /**
   * Q1 2026 данные из DDS 2026
   */
  function getQ1Fact(dds, year) {
    const entry = dds && dds.find(d => d.year === year)
    if (!entry) return { revenue: 0, opExpense: 0 }

    let revenue = 0
    let opExpense = 0

    ;(entry.incomeRows || []).forEach(row => {
      // Суммируем январь-март (первые 3 месяца)
      const vals = row.values || []
      if (row.name && !row.name.toLowerCase().includes('финансов') && !row.name.toLowerCase().includes('кредит')) {
        for (let i = 0; i < Math.min(3, vals.length); i++) {
          revenue += (vals[i] || 0)
        }
      }
    })

    // Если нет values — пробуем через incomeItogo
    if (revenue === 0 && entry.incomeItogo) {
      revenue = entry.incomeItogo.total || 0
    }

    ;(entry.expenseRows || []).forEach(row => {
      const block = classifyRow(row.name || '')
      if (block.startsWith('__')) return
      const vals = row.values || []
      for (let i = 0; i < Math.min(3, vals.length); i++) {
        opExpense += (vals[i] || 0)
      }
    })

    return { revenue, opExpense }
  }

  /**
   * Извлекает ежедневные транзакции из cashLedger (если есть)
   */
  function getCashLedger(rawData) {
    if (!rawData || !Array.isArray(rawData.cashLedger)) return []
    return rawData.cashLedger
  }

  // ─── ЭКСПОРТ ──────────────────────────────────────────────────────────────
  global.FinanceData = {
    FACT_2025_MONTHLY,
    INCOME_2025_MONTHLY,
    TOTALS_2025,
    BLOCK_META,
    BLOCK_KEYS,
    EXPENSE_TO_BLOCK,
    MONTHS_SHORT,
    isDdsComplete,
    getMonthlyData,
    getCostBlockTotals,
    getMonthlyByBlock,
    getCostTree,
    getQ1Fact,
    getCashLedger,
    classifyRow
  }
})(window)
