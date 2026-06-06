'use strict'

const { chromium } = require('../dashboard/node_modules/@playwright/test')

async function test() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  })

  const page = await browser.newPage()

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })

  // Логируем ВСЕ ответы 2GIS
  page.on('response', async (response) => {
    const url = response.url()
    if (!url.includes('2gis')) return
    const status = response.status()
    console.log(`[RESP ${status}] ${url.slice(0, 120)}`)
    if (url.includes('items') || url.includes('suggest') || url.includes('geocode') || url.includes('search')) {
      try {
        const text = await response.text()
        const json = JSON.parse(text)
        const items = json?.result?.items || json?.data?.items || []
        console.log(`  → items: ${items.length}`)
        if (items.length > 0) {
          const first = items[0]
          console.log(`  → first keys: ${Object.keys(first).join(', ')}`)
          console.log(`  → point: ${JSON.stringify(first.point)}`)
          console.log(`  → geometry: ${JSON.stringify(first.geometry)}`)
        }
      } catch {}
    }
  })

  const address = 'улица Жарокова 10'
  const searchUrl = `https://2gis.kz/almaty/search/${encodeURIComponent(address)}`
  console.log('Открываю:', searchUrl)
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.waitForTimeout(3000)

  const finalUrl = page.url()
  console.log('\nФинальный URL:', finalUrl)

  // Проверяем ?m= паттерн
  const mMatch = finalUrl.match(/[?&]m=([\d.]+)[%2C,]+([\d.]+)/i)
  if (mMatch) {
    console.log('?m= найден: lng=' + mMatch[1] + ', lat=' + mMatch[2])
  } else {
    console.log('?m= НЕ найден в URL')
  }

  // Проверяем текст страницы на координаты
  const text = await page.evaluate(() => document.body.innerText)
  const coordMatch = text.match(/(\d{2}\.\d{5,}),\s*(\d{2}\.\d{5,})/)
  if (coordMatch) {
    console.log('Координаты в тексте:', coordMatch[0])
  } else {
    console.log('Координаты в тексте НЕ найдены')
    // Покажем первые 500 символов текста
    console.log('Текст страницы (начало):', text.slice(0, 300))
  }

  await page.waitForTimeout(5000) // смотрим браузер
  await browser.close()
}

test().catch(e => console.error(e.message))
