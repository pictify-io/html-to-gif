const puppeteer = require('puppeteer')
const genericPool = require('generic-pool')

const browserConfig = {
  headless: 'new',
  args: [
    '--autoplay-policy=user-gesture-required',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-breakpad',
    '--disable-client-side-phishing-detection',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-domain-reliability',
    '--disable-extensions',
    '--disable-features=AudioServiceOutOfProcess',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-notifications',
    '--disable-offer-store-unmasked-wallet-cards',
    '--disable-popup-blocking',
    '--disable-print-preview',
    '--disable-prompt-on-repost',
    '--disable-renderer-backgrounding',
    '--disable-setuid-sandbox',
    '--disable-speech-api',
    '--disable-sync',
    '--hide-scrollbars',
    '--ignore-gpu-blacklist',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-default-browser-check',
    '--no-first-run',
    '--no-pings',
    '--no-sandbox',
    '--no-zygote',
    '--password-store=basic',
    '--use-gl=swiftshader',
    '--use-mock-keychain',
    '--disable-gpu',
    '--allow-file-access-from-files',
    '--disable-web-security',
    '--enable-precise-memory-info',
    '--js-flags="--max-old-space-size=4096"'
  ],
  ignoreDefaultArgs: ['--disable-extensions'],
  protocolTimeout: 60000
}

let browserPool
let pagePool

const MAX_PAGES_PER_BROWSER = 20
const MAX_BROWSERS = 5

const createPage = async (browser) => {
  const page = await browser.newPage()
  page.setDefaultNavigationTimeout(30000)
  page.setDefaultTimeout(30000)
  page.on('error', err => console.error('Page crashed:', err))
  page.on('pageerror', err => console.error('Page error:', err))
  return page
}

const initializeBrowserPool = async () => {
  // Create browser pool
  browserPool = genericPool.createPool(
    {
      create: async () => {
        const browser = await puppeteer.launch(browserConfig)
        browser.pageCount = 0 // Track number of pages per browser
        return browser
      },
      destroy: async (browser) => {
        try {
          const pages = await browser.pages()
          await Promise.all(pages.map(page => page.close()))
          await browser.close()
        } catch (err) {
          console.error('Error destroying browser:', err)
        }
      },
      validate: async (browser) => {
        try {
          const pages = await browser.pages()
          return pages.length <= MAX_PAGES_PER_BROWSER && browser.connected
        } catch (err) {
          return false
        }
      }
    },
    {
      min: 1,
      max: MAX_BROWSERS,
      acquireTimeoutMillis: 60000,
      idleTimeoutMillis: 300000, // 5 minutes idle timeout
      evictionRunIntervalMillis: 60000, // Check every minute
      numTestsPerEvictionRun: 3,
      autostart: true
    }
  )

  // Create page pool
  pagePool = genericPool.createPool(
    {
      create: async () => {
        // Try to find a browser with available page slots
        let browser = null
        const browsers = await Promise.all(
          Array.from({ length: browserPool.size }, async () => {
            try {
              return await browserPool.acquire()
            } catch (e) {
              return null
            }
          })
        )

        for (const b of browsers.filter(b => b)) {
          const pages = await b.pages()
          if (pages.length < MAX_PAGES_PER_BROWSER) {
            browser = b
            break
          }
          await browserPool.release(b)
        }

        // If no browser has slots, create a new one
        if (!browser) {
          browser = await browserPool.acquire()
        }

        try {
          const page = await createPage(browser)
          page.browser = browser
          browser.pageCount = (browser.pageCount || 0) + 1
          return page
        } catch (err) {
          await browserPool.release(browser)
          throw err
        }
      },
      destroy: async (page) => {
        try {
          const browser = page.browser
          await page.close()
          browser.pageCount--
          await browserPool.release(browser)
        } catch (err) {
          console.error('Error destroying page:', err)
        }
      },
      validate: async (page) => {
        try {
          await page.evaluate(() => true)
          return true
        } catch (err) {
          return false
        }
      }
    },
    {
      min: 2,
      max: MAX_BROWSERS * MAX_PAGES_PER_BROWSER, // Maximum total pages across all browsers
      acquireTimeoutMillis: 60000,
      idleTimeoutMillis: 60000, // 1 minute idle timeout for pages
      evictionRunIntervalMillis: 30000,
      numTestsPerEvictionRun: 5,
      autostart: true
    }
  )

  // Initialize with some pages
  const initialPage = pagePool.acquire()
  await initialPage
  pagePool.release(await initialPage)

  console.log('Browser and page pools initialized')
}

const acquirePage = async () => {
  if (!pagePool) {
    throw new Error('Page pool not initialized')
  }
  return await pagePool.acquire()
}

const releasePage = async (page) => {
  if (!pagePool) {
    throw new Error('Page pool not initialized')
  }
  try {
    // Just navigate to blank page to clear any state
    await page.goto('about:blank')
    await pagePool.release(page)
  } catch (err) {
    console.error('Error releasing page:', err)
    // Force destroy the page if we can't clean it
    await pagePool.destroy(page)
  }
}

const cleanup = async () => {
  if (pagePool) {
    await pagePool.drain()
    await pagePool.clear()
  }
  if (browserPool) {
    await browserPool.drain()
    await browserPool.clear()
  }
}

module.exports = {
  initializeBrowserPool,
  acquirePage,
  releasePage,
  cleanup,
  getPoolStats: () => ({
    browser: browserPool ? {
      size: browserPool.size,
      available: browserPool.available,
      pending: browserPool.pending,
      max: browserPool.max,
      min: browserPool.min
    } : null,
    page: pagePool ? {
      size: pagePool.size,
      available: pagePool.available,
      pending: pagePool.pending,
      max: pagePool.max,
      min: pagePool.min
    } : null
  })
}
