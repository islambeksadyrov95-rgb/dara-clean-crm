const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

async function runTest() {
  console.log('Запуск UI-теста с помощью Puppeteer...');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Установим размер экрана
  await page.setViewport({ width: 1280, height: 900 });
  
  try {
    console.log('Переход на http://localhost:3001/login...');
    await page.goto('http://localhost:3001/login', { waitUntil: 'networkidle2', timeout: 30000 });
    
    console.log('Ожидание формы авторизации...');
    await page.waitForSelector('input#email', { timeout: 10000 });
    await page.waitForSelector('input#password', { timeout: 10000 });
    await page.waitForSelector('button[type="submit"]', { timeout: 10000 });
    
    console.log('Заполнение полей...');
    await page.type('input#email', 'temp_manager_test@daraclean.ru');
    await page.type('input#password', 'TempPassword123!');
    
    console.log('Нажатие кнопки входа...');
    await page.click('button[type="submit"]');
    
    console.log('Ожидаем переход на /queue...');
    await page.waitForFunction(() => window.location.pathname.includes('/queue'), { timeout: 20000 });
    
    const currentUrl = page.url();
    console.log('Текущий URL:', currentUrl);
    
    console.log('Успешный переход на /queue!');
    
    // Ждем загрузки очереди звонков (пока пропадет надпись "Загрузка..." или появится текст страницы)
    console.log('Ожидание элементов интерфейса очереди звонков...');
    await page.waitForFunction(
      () => {
        const text = document.body.innerText;
        return text.includes('Очередь звонков') && (text.includes('Звонки') || text.includes('Заказы'));
      },
      { timeout: 20000 }
    );
    
    console.log('Интерфейс очереди звонков и плана дня успешно загружен.');
    
    // Сделаем скриншот
    const screenshotPath = path.join(__dirname, '..', 'queue_screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Скриншот успешно сохранен: ${screenshotPath}`);
    
    console.log('Тест успешно завершен!');
    process.exitCode = 0;
  } catch (error) {
    console.error('Ошибка во время прохождения теста:', error);
    
    try {
      const errorScreenshotPath = path.join(__dirname, '..', 'error_screenshot.png');
      await page.screenshot({ path: errorScreenshotPath, fullPage: true });
      console.log(`Скриншот ошибки сохранен: ${errorScreenshotPath}`);
    } catch (scrError) {
      console.error('Не удалось сделать скриншот ошибки:', scrError);
    }
    
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

runTest();
