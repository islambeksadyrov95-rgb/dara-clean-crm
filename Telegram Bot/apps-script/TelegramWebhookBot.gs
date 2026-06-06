// ===== DaraClean Telegram Bot (autonomous, no server) =====
// Runs inside Google Apps Script as Web App webhook handler.
//
// Setup:
// 1) In Apps Script: Project Settings -> Script properties:
//    - BOT_TOKEN = <telegram token>
//    - TZ = Asia/Almaty (optional)
// 2) Deploy -> New deployment -> Web app
//    - Execute as: Me
//    - Who has access: Anyone
// 3) After deploy, run setWebhook() once (from Apps Script editor)
//
// This bot writes to the same sheets as Api.gs:
// - dict sheet: "Справочник"
// - entries sheet: "Ежедневно"

const DC_SHEETS = {
  dict: 'Справочник',
  entries: 'Ежедневно'
}

const DC_STEPS = {
  idle: 'idle',
  pickOperationType: 'pickOperationType',
  pickPaymentType: 'pickPaymentType',
  pickCategory: 'pickCategory',
  pickArticle: 'pickArticle',
  pickEmployee: 'pickEmployee',
  enterAmount: 'enterAmount',
  enterComment: 'enterComment',
  confirm: 'confirm'
}

const dcGetProp_ = (key) => PropertiesService.getScriptProperties().getProperty(key)
const dcSetProp_ = (key, value) => PropertiesService.getScriptProperties().setProperty(key, value)

const dcGetBotToken_ = () => {
  const token = dcGetProp_('BOT_TOKEN')
  if (!token) throw new Error('Missing script property BOT_TOKEN')
  return token
}

const dcGetTz_ = () => dcGetProp_('TZ') || 'Asia/Almaty'

const dcApi_ = (method, payload) => {
  const token = dcGetBotToken_()
  const url = `https://api.telegram.org/bot${token}/${method}`
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  })
  const text = res.getContentText()
  const json = JSON.parse(text)
  if (!json.ok) throw new Error(json.description || 'Telegram API error')
  return json.result
}

const dcAnswerCallback_ = (callbackQueryId) => {
  if (!callbackQueryId) return
  dcApi_('answerCallbackQuery', { callback_query_id: callbackQueryId })
}

const dcSendMessage_ = (chatId, text, replyMarkup) => {
  const payload = { chat_id: chatId, text }
  if (replyMarkup) payload.reply_markup = replyMarkup
  return dcApi_('sendMessage', payload)
}

const dcEditMessage_ = (chatId, messageId, text, replyMarkup) => {
  const payload = { chat_id: chatId, message_id: messageId, text }
  if (replyMarkup) payload.reply_markup = replyMarkup
  return dcApi_('editMessageText', payload)
}

const dcIsoToday_ = () => {
  const tz = dcGetTz_()
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd')
}

const dcSessionKey_ = (chatId) => `session:${chatId}`

const dcGetSession_ = (chatId) => {
  const raw = dcGetProp_(dcSessionKey_(chatId))
  if (!raw) return { step: DC_STEPS.idle, draft: { dateIso: dcIsoToday_() }, wizardMessageId: null }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || !parsed.step || !parsed.draft) return { step: DC_STEPS.idle, draft: { dateIso: dcIsoToday_() }, wizardMessageId: null }
    if (parsed.wizardMessageId === undefined) parsed.wizardMessageId = null
    return parsed
  } catch (e) {
    return { step: DC_STEPS.idle, draft: { dateIso: dcIsoToday_() }, wizardMessageId: null }
  }
}

const dcSaveSession_ = (chatId, session) => dcSetProp_(dcSessionKey_(chatId), JSON.stringify(session))

const dcResetSession_ = (chatId) =>
  dcSetProp_(dcSessionKey_(chatId), JSON.stringify({ step: DC_STEPS.idle, draft: { dateIso: dcIsoToday_() }, wizardMessageId: null }))

const dcChunk_ = (items, perRow) => {
  if (!perRow || perRow <= 0) return [items]
  const result = []
  for (let i = 0; i < items.length; i += perRow) result.push(items.slice(i, i + perRow))
  return result
}

const dcKeyboard_ = (items, prefix, perRow) => {
  const rows = dcChunk_(items, perRow || 2)
  return {
    inline_keyboard: rows.map((row) => row.map((label) => ({ text: label, callback_data: `${prefix}:${label}` })))
  }
}

const dcNavRow_ = (opts) => {
  const backTo = opts && opts.backTo ? String(opts.backTo) : ''
  const buttons = []
  if (backTo) buttons.push({ text: '⬅️ Назад', callback_data: `nav:back:${backTo}` })
  buttons.push({ text: '✖️ Отмена', callback_data: 'nav:cancel' })
  return buttons
}

const dcWithNav_ = (kb, opts) => {
  const base = kb && kb.inline_keyboard ? kb.inline_keyboard : []
  const out = base.slice()
  out.push(dcNavRow_(opts))
  return { inline_keyboard: out }
}

const dcUpsertWizard_ = (chatId, session, text, replyMarkup) => {
  const hasMessage = session && session.wizardMessageId && Number(session.wizardMessageId) > 0
  if (hasMessage) {
    try {
      dcEditMessage_(chatId, Number(session.wizardMessageId), text, replyMarkup)
      return session
    } catch (e) {
      // fall back to send
    }
  }

  const sent = dcSendMessage_(chatId, text, replyMarkup)
  session.wizardMessageId = sent && sent.message_id ? sent.message_id : null
  dcSaveSession_(chatId, session)
  return session
}

const dcParseAmount_ = (text) => {
  const normalized = String(text || '').replace(/\s/g, '').replace(',', '.')
  const value = Number(normalized)
  if (!Number.isFinite(value)) return null
  if (value <= 0) return null
  return value
}

const dcGetDict_ = () => {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DC_SHEETS.dict)
  if (!sheet) throw new Error(`Sheet not found: ${DC_SHEETS.dict}`)
  const lastRow = sheet.getLastRow()
  const lastCol = sheet.getLastColumn()
  if (lastRow < 2 || lastCol < 1) {
    return { operationTypes: [], paymentTypes: [], categories: [], articlesByCategory: {}, employees: [] }
  }

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues()
  const headers = values[0].map((h) => String(h || '').trim())

  const findCol = (name) => headers.findIndex((h) => h.toLowerCase() === String(name).toLowerCase())

  const colOperationType = findCol('Тип операции')
  const colPaymentType = findCol('Тип оплаты')
  const colCategory = findCol('Категория')
  const colArticle = findCol('Статья')
  const colEmployee = findCol('Сотрудник')

  const operationTypes = {}
  const paymentTypes = {}
  const categories = {}
  const employees = {}
  const articlesByCategory = {}

  for (let i = 1; i < values.length; i++) {
    const row = values[i]
    const op = colOperationType >= 0 ? String(row[colOperationType] || '').trim() : ''
    const pay = colPaymentType >= 0 ? String(row[colPaymentType] || '').trim() : ''
    const cat = colCategory >= 0 ? String(row[colCategory] || '').trim() : ''
    const art = colArticle >= 0 ? String(row[colArticle] || '').trim() : ''
    const emp = colEmployee >= 0 ? String(row[colEmployee] || '').trim() : ''

    if (op) operationTypes[op] = true
    if (pay) paymentTypes[pay] = true
    if (cat) categories[cat] = true
    if (emp) employees[emp] = true
    if (cat && art) {
      if (!articlesByCategory[cat]) articlesByCategory[cat] = {}
      articlesByCategory[cat][art] = true
    }
  }

  const articlesByCategoryOut = {}
  Object.keys(articlesByCategory).forEach((cat) => {
    articlesByCategoryOut[cat] = Object.keys(articlesByCategory[cat]).sort()
  })

  return {
    operationTypes: Object.keys(operationTypes).sort(),
    paymentTypes: Object.keys(paymentTypes).sort(),
    categories: Object.keys(categories).sort(),
    articlesByCategory: articlesByCategoryOut,
    employees: Object.keys(employees).sort()
  }
}

const dcAppendEntry_ = (draft, meta) => {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DC_SHEETS.entries)
  if (!sheet) throw new Error(`Sheet not found: ${DC_SHEETS.entries}`)

  const row = [
    draft.dateIso,
    draft.operationType,
    draft.paymentType,
    draft.category,
    draft.article,
    draft.employee || '',
    Number(draft.amount),
    draft.comment || '',
    String(meta.chatId),
    String(meta.userId),
    meta.username || '',
    meta.createdAtIso
  ]

  sheet.appendRow(row)
  return sheet.getLastRow()
}

const dcListEntries_ = (limit) => {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DC_SHEETS.entries)
  if (!sheet) throw new Error(`Sheet not found: ${DC_SHEETS.entries}`)
  const lastRow = sheet.getLastRow()
  if (lastRow < 2) return []

  const lastCol = Math.max(12, sheet.getLastColumn())
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues()
  const data = values.slice(1)
  const safeLimit = Math.max(1, Math.min(50, Number(limit || 10)))
  const recent = data.slice(Math.max(0, data.length - safeLimit)).reverse()

  return recent
    .map((r) => ({
      dateIso: String(r[0] || ''),
      operationType: String(r[1] || ''),
      paymentType: String(r[2] || ''),
      category: String(r[3] || ''),
      article: String(r[4] || ''),
      employee: String(r[5] || '') || '',
      amount: Number(r[6] || 0),
      comment: String(r[7] || '') || ''
    }))
    .filter((e) => e.dateIso && e.operationType && e.category && e.article)
}

const dcMonthStats_ = (month) => {
  const m = String(month || '').trim()
  if (!/^\d{4}-\d{2}$/.test(m)) throw new Error('Invalid month format, expected YYYY-MM')

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DC_SHEETS.entries)
  if (!sheet) throw new Error(`Sheet not found: ${DC_SHEETS.entries}`)
  const lastRow = sheet.getLastRow()
  if (lastRow < 2) return { month: m, totalsByCategory: {}, total: 0 }

  const lastCol = Math.max(12, sheet.getLastColumn())
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues()
  const data = values.slice(1)

  const totalsByCategory = {}
  let total = 0

  for (let i = 0; i < data.length; i++) {
    const r = data[i]
    const dateIso = String(r[0] || '')
    if (!dateIso.startsWith(m)) continue

    const operationType = String(r[1] || '')
    const category = String(r[3] || '')
    const amount = Number(r[6] || 0)
    if (!category || !Number.isFinite(amount)) continue

    const isExpense = operationType.toLowerCase().includes('расход') || operationType.toLowerCase().includes('минус')
    const signed = isExpense ? -Math.abs(amount) : Math.abs(amount)

    totalsByCategory[category] = (totalsByCategory[category] || 0) + signed
    total += signed
  }

  return { month: m, totalsByCategory, total }
}

const dcSummary_ = (draft) => {
  const lines = []
  if (draft.operationType) lines.push(`Тип операции: ${draft.operationType}`)
  if (draft.paymentType) lines.push(`Тип оплаты: ${draft.paymentType}`)
  if (draft.category) lines.push(`Категория: ${draft.category}`)
  if (draft.article) lines.push(`Статья: ${draft.article}`)
  if (draft.employee) lines.push(`Сотрудник: ${draft.employee}`)
  if (typeof draft.amount === 'number') lines.push(`Сумма: ${draft.amount}`)
  if (draft.comment) lines.push(`Комментарий: ${draft.comment}`)
  if (draft.dateIso) lines.push(`Дата: ${draft.dateIso}`)
  return lines.join('\n')
}

const dcHandleCommand_ = (chatId, user, text) => {
  const cmd = String(text || '').trim().split(/\s+/)[0]

  if (cmd === '/start' || cmd === '/help') {
    dcResetSession_(chatId)
    dcSendMessage_(
      chatId,
      ['Привет! Я записываю расходы/доходы в таблицу.', '', 'Команды:', '/add', '/cancel', '/last', '/stats'].join('\n')
    )
    return
  }

  if (cmd === '/cancel') {
    const session = dcGetSession_(chatId)
    const next = { step: DC_STEPS.idle, draft: { dateIso: dcIsoToday_() }, wizardMessageId: session.wizardMessageId }
    dcSaveSession_(chatId, next)
    dcUpsertWizard_(chatId, next, 'Ок, отменил. Чтобы начать заново: /add', null)
    return
  }

  if (cmd === '/add') {
    const session = dcGetSession_(chatId)
    const next = { step: DC_STEPS.pickOperationType, draft: { dateIso: dcIsoToday_() }, wizardMessageId: session.wizardMessageId }
    dcSaveSession_(chatId, next)
    const dict = dcGetDict_()
    dcUpsertWizard_(chatId, next, 'Выберите тип операции', dcWithNav_(dcKeyboard_(dict.operationTypes, 'op', 2), { backTo: '' }))
    return
  }

  if (cmd === '/last') {
    const entries = dcListEntries_(10)
    if (!entries.length) {
      dcSendMessage_(chatId, 'Пока нет операций.')
      return
    }
    const lines = entries.map((e, idx) => {
      const isExpense = e.operationType.toLowerCase().includes('расход') || e.operationType.toLowerCase().includes('минус')
      const sign = isExpense ? '-' : '+'
      const base = `${idx + 1}) ${e.dateIso} ${sign}${e.amount} — ${e.category} / ${e.article}`
      const extra = [e.paymentType, e.employee, e.comment].filter((x) => String(x || '').trim().length).join(' · ')
      return extra.length ? `${base}\n   ${extra}` : base
    })
    dcSendMessage_(chatId, lines.join('\n\n'))
    return
  }

  if (cmd === '/stats') {
    const month = dcIsoToday_().slice(0, 7)
    const stats = dcMonthStats_(month)
    const pairs = Object.keys(stats.totalsByCategory).map((k) => [k, stats.totalsByCategory[k]])
    pairs.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    const lines = [`Статистика за ${stats.month}`, '', ...pairs.map((p) => `- ${p[0]}: ${p[1]}`), '', `Итого: ${stats.total}`]
    dcSendMessage_(chatId, lines.join('\n'))
    return
  }

  const session = dcGetSession_(chatId)
  if (session.step === DC_STEPS.enterAmount) {
    const amount = dcParseAmount_(text)
    if (!amount) {
      dcUpsertWizard_(chatId, session, 'Не понял сумму. Пример: 1250 или 1 250,50\n\nВведите сумму ещё раз', dcWithNav_({ inline_keyboard: [] }, { backTo: 'pickEmployee' }))
      return
    }
    session.draft.amount = amount
    session.step = DC_STEPS.enterComment
    dcSaveSession_(chatId, session)
    dcUpsertWizard_(chatId, session, 'Комментарий? (можно написать "-" чтобы пропустить)', dcWithNav_({ inline_keyboard: [] }, { backTo: 'enterAmount' }))
    return
  }

  if (session.step === DC_STEPS.enterComment) {
    const t = String(text || '').trim()
    if (t !== '-' && t.length) session.draft.comment = t
    session.step = DC_STEPS.confirm
    dcSaveSession_(chatId, session)
    const summary = dcSummary_(session.draft)
    dcUpsertWizard_(chatId, session, `Проверьте:\n\n${summary}`, {
      inline_keyboard: [
        [{ text: '✅ Сохранить', callback_data: 'confirm:save' }, { text: '⬅️ Назад', callback_data: 'nav:back:enterComment' }],
        [{ text: '✖️ Отмена', callback_data: 'nav:cancel' }]
      ]
    })
    return
  }

  if (session.step !== DC_STEPS.idle) {
    dcSendMessage_(chatId, 'Я сейчас в режиме добавления операции. Если хотите отменить: /cancel')
    return
  }
}

const dcHandleCallback_ = (chatId, callbackQueryId, data, message) => {
  dcAnswerCallback_(callbackQueryId)

  const session = dcGetSession_(chatId)
  if (message && message.message_id) {
    session.wizardMessageId = message.message_id
    dcSaveSession_(chatId, session)
  }
  const dict = dcGetDict_()

  const parts = String(data || '').split(':')
  const prefix = parts[0] || ''
  const value = parts.slice(1).join(':')

  if (prefix === 'nav') {
    const action = parts[1] || ''
    const backTo = parts[2] || ''

    if (action === 'cancel') {
      const next = { step: DC_STEPS.idle, draft: { dateIso: dcIsoToday_() }, wizardMessageId: session.wizardMessageId }
      dcSaveSession_(chatId, next)
      dcUpsertWizard_(chatId, next, 'Отменено. Чтобы начать заново: /add', null)
      return
    }

    if (action === 'back') {
      const target = String(backTo || '')
      if (!target) return
      session.step = target
      dcSaveSession_(chatId, session)

      if (target === DC_STEPS.pickOperationType) {
        dcUpsertWizard_(chatId, session, 'Выберите тип операции', dcWithNav_(dcKeyboard_(dict.operationTypes, 'op', 2), { backTo: '' }))
        return
      }
      if (target === DC_STEPS.pickPaymentType) {
        dcUpsertWizard_(chatId, session, 'Выберите тип оплаты', dcWithNav_(dcKeyboard_(dict.paymentTypes, 'pay', 2), { backTo: 'pickOperationType' }))
        return
      }
      if (target === DC_STEPS.pickCategory) {
        dcUpsertWizard_(chatId, session, 'Выберите категорию', dcWithNav_(dcKeyboard_(dict.categories, 'cat', 2), { backTo: 'pickPaymentType' }))
        return
      }
      if (target === DC_STEPS.pickArticle) {
        const cat = session.draft.category
        const articles = (cat && dict.articlesByCategory[cat]) || []
        dcUpsertWizard_(chatId, session, 'Выберите статью', dcWithNav_(dcKeyboard_(articles, 'art', 2), { backTo: 'pickCategory' }))
        return
      }
      if (target === DC_STEPS.pickEmployee) {
        dcUpsertWizard_(chatId, session, 'Выберите сотрудника (или пропустить)', dcWithNav_(dcKeyboard_(['пропустить'].concat(dict.employees), 'emp', 2), { backTo: 'pickArticle' }))
        return
      }
      if (target === DC_STEPS.enterAmount) {
        dcUpsertWizard_(chatId, session, 'Введите сумму (например: 1250 или 1 250,50)', dcWithNav_({ inline_keyboard: [] }, { backTo: 'pickEmployee' }))
        return
      }
      if (target === DC_STEPS.enterComment) {
        dcUpsertWizard_(chatId, session, 'Комментарий? (можно написать "-" чтобы пропустить)', dcWithNav_({ inline_keyboard: [] }, { backTo: 'enterAmount' }))
        return
      }
    }
  }

  if (prefix === 'restart') {
    const next = { step: DC_STEPS.idle, draft: { dateIso: dcIsoToday_() }, wizardMessageId: session.wizardMessageId }
    dcSaveSession_(chatId, next)
    dcUpsertWizard_(chatId, next, 'Ок, начнем заново: /add', null)
    return
  }

  if (prefix === 'op' && session.step === DC_STEPS.pickOperationType) {
    session.draft.operationType = value
    session.step = DC_STEPS.pickPaymentType
    dcSaveSession_(chatId, session)
    dcUpsertWizard_(chatId, session, 'Выберите тип оплаты', dcWithNav_(dcKeyboard_(dict.paymentTypes, 'pay', 2), { backTo: 'pickOperationType' }))
    return
  }

  if (prefix === 'pay' && session.step === DC_STEPS.pickPaymentType) {
    session.draft.paymentType = value
    session.step = DC_STEPS.pickCategory
    dcSaveSession_(chatId, session)
    dcUpsertWizard_(chatId, session, 'Выберите категорию', dcWithNav_(dcKeyboard_(dict.categories, 'cat', 2), { backTo: 'pickPaymentType' }))
    return
  }

  if (prefix === 'cat' && session.step === DC_STEPS.pickCategory) {
    session.draft.category = value
    session.step = DC_STEPS.pickArticle
    dcSaveSession_(chatId, session)
    const articles = dict.articlesByCategory[value] || []
    if (!articles.length) {
      dcUpsertWizard_(chatId, session, 'В справочнике нет статей для этой категории. Выберите другую категорию.', dcWithNav_(dcKeyboard_(dict.categories, 'cat', 2), { backTo: 'pickPaymentType' }))
      return
    }
    dcUpsertWizard_(chatId, session, 'Выберите статью', dcWithNav_(dcKeyboard_(articles, 'art', 2), { backTo: 'pickCategory' }))
    return
  }

  if (prefix === 'art' && session.step === DC_STEPS.pickArticle) {
    session.draft.article = value
    session.step = DC_STEPS.pickEmployee
    dcSaveSession_(chatId, session)
    dcUpsertWizard_(chatId, session, 'Выберите сотрудника (или пропустить)', dcWithNav_(dcKeyboard_(['пропустить'].concat(dict.employees), 'emp', 2), { backTo: 'pickArticle' }))
    return
  }

  if (prefix === 'emp' && session.step === DC_STEPS.pickEmployee) {
    if (value !== 'пропустить') session.draft.employee = value
    session.step = DC_STEPS.enterAmount
    dcSaveSession_(chatId, session)
    dcUpsertWizard_(chatId, session, 'Введите сумму (например: 1250 или 1 250,50)', dcWithNav_({ inline_keyboard: [] }, { backTo: 'pickEmployee' }))
    return
  }

  if (prefix === 'confirm' && value === 'save' && session.step === DC_STEPS.confirm) {
    const draft = session.draft
    if (!draft.operationType || !draft.paymentType || !draft.category || !draft.article || typeof draft.amount !== 'number' || !draft.dateIso) {
      const next = { step: DC_STEPS.idle, draft: { dateIso: dcIsoToday_() }, wizardMessageId: session.wizardMessageId }
      dcSaveSession_(chatId, next)
      dcUpsertWizard_(chatId, next, 'Не хватает данных для сохранения. Начните заново: /add', null)
      return
    }

    const meta = {
      chatId,
      userId: (message && message.from && message.from.id) || 0,
      username: (message && message.from && message.from.username) || '',
      createdAtIso: new Date().toISOString()
    }

    const rowNumber = dcAppendEntry_(draft, meta)
    const next = { step: DC_STEPS.idle, draft: { dateIso: dcIsoToday_() }, wizardMessageId: session.wizardMessageId }
    dcSaveSession_(chatId, next)
    dcUpsertWizard_(chatId, next, `Готово. Запись добавлена (строка ${rowNumber})\n\nЧтобы добавить ещё: /add`, null)
    return
  }
}

function doPost(e) {
  try {
    const update = JSON.parse((e && e.postData && e.postData.contents) || '{}')

    if (update.callback_query) {
      const cq = update.callback_query
      const chatId = cq.message && cq.message.chat && cq.message.chat.id
      if (chatId) dcHandleCallback_(chatId, cq.id, cq.data, cq.message)
      return ContentService.createTextOutput('ok')
    }

    if (update.message && update.message.text) {
      const msg = update.message
      const chatId = msg.chat && msg.chat.id
      if (chatId) dcHandleCommand_(chatId, msg.from, msg.text)
      return ContentService.createTextOutput('ok')
    }

    return ContentService.createTextOutput('ok')
  } catch (error) {
    return ContentService.createTextOutput('error')
  }
}

function setWebhook() {
  const token = dcGetBotToken_()
  const webAppUrl = ScriptApp.getService().getUrl()
  if (!webAppUrl) throw new Error('Deploy web app first, then run setWebhook()')

  const url = `https://api.telegram.org/bot${token}/setWebhook`
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ url: webAppUrl }),
    muteHttpExceptions: true
  })
  return res.getContentText()
}

