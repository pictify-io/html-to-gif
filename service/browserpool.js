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

const initializeBrowserPool = async () => {
  browserPool = genericPool.createPool(
    {
      create: async () => {
        const browser = await puppeteer.launch(browserConfig)
        // Set up browser-level memory monitoring
        const pages = await browser.pages()
        pages.forEach(page => {
          page.on('error', err => console.error('Page crashed:', err))
          page.on('pageerror', err => console.error('Page error:', err))
        })
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
          return pages.length < 10 // Validate that browser doesn't have too many pages open
        } catch (err) {
          return false
        }
      }
    },
    {
      min: 1, // Reduce minimum browsers
      max: 5, // Reduce maximum browsers
      acquireTimeoutMillis: 60000,
      idleTimeoutMillis: 120000, // Reduce idle timeout to 2 minutes
      evictionRunIntervalMillis: 30000, // Run eviction every 30 seconds
      numTestsPerEvictionRun: 3,
      autostart: true
    }
  )

  // Pre-create the minimum number of browsers
  const initialBrowser = browserPool.acquire()
  await initialBrowser
  browserPool.release(await initialBrowser)

  console.log('Browser pool initialized')
}

const acquireBrowser = async () => {
  if (!browserPool) {
    throw new Error('Browser pool not initialized')
  }
  return await browserPool.acquire()
}

const releaseBrowser = async (browser) => {
  if (!browserPool) {
    throw new Error('Browser pool not initialized')
  }
  await browserPool.release(browser)
}

const cleanup = async () => {
  if (browserPool) {
    await browserPool.drain()
    await browserPool.clear()
  }
}

module.exports = {
  initializeBrowserPool,
  acquireBrowser,
  releaseBrowser,
  cleanup,
  getPoolStats: () => browserPool ? {
    size: browserPool.size,
    available: browserPool.available,
    pending: browserPool.pending,
    max: browserPool.max,
    min: browserPool.min
  } : null
}
