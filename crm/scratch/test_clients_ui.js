const puppeteer = require('puppeteer');
const path = require('path');

async function run() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  page.on('console', msg => {
    console.log(`[BROWSER CONSOLE] ${msg.type().toUpperCase()}: ${msg.text()}`);
  });
  
  page.on('pageerror', err => {
    console.error(`[BROWSER ERROR] ${err.toString()}`);
  });
  
  page.on('requestfailed', request => {
    console.log(`[REQUEST FAILED] ${request.url()} - ${request.failure().errorText}`);
  });

  try {
    console.log('Navigating to login page...');
    await page.goto('https://crm-roan-ten.vercel.app/login', { waitUntil: 'networkidle2' });
    
    console.log('Entering credentials...');
    await page.type('#email', 'samal@daraclean.kz');
    await page.type('#password', 'admin12345');
    
    console.log('Submitting login form...');
    await page.click('button[type="submit"]');
    
    console.log('Waiting for navigation to /queue...');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    console.log('Current URL after login:', page.url());
    
    console.log('Navigating to /clients...');
    await page.goto('https://crm-roan-ten.vercel.app/clients', { waitUntil: 'networkidle2' });
    console.log('Current URL after navigating:', page.url());
    console.log('Waiting for table to load and buttons to render...');
    await page.waitForSelector('table tbody tr button');
    
    // 1. Тестируем выбор клиента (клик на первую строку или кнопку "Выбрать")
    console.log('Clicking "Выбрать" button for the first client...');
    const selectButtons = await page.$$('table tbody tr button');
    if (selectButtons.length > 0) {
      await selectButtons[0].click();
      console.log('Clicked. Waiting 3 seconds for sidebar to open and fetch history...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const screenshotPath = path.join(__dirname, 'prod_clients_selected_screenshot.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Selection screenshot saved to: ${screenshotPath}`);
    } else {
      console.log('No select buttons found!');
    }
    
    // 2. Тестируем фильтрацию по сегменту
    console.log('Clicking filter button "Новый"...');
    // Ищем кнопку с текстом "Новый"
    const buttons = await page.$$('button');
    let newFilterBtn = null;
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.trim() === 'Новый') {
        newFilterBtn = btn;
        break;
      }
    }
    
    if (newFilterBtn) {
      await newFilterBtn.click();
      console.log('Clicked "Новый" filter. Waiting 3 seconds...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const screenshotPath = path.join(__dirname, 'prod_clients_filter_new_screenshot.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Filter screenshot saved to: ${screenshotPath}`);
    } else {
      console.log('Filter button "Новый" not found');
    }
    
  } catch (err) {
    console.error('Error during execution:', err);
  } finally {
    await browser.close();
    console.log('Browser closed.');
  }
}

run();
