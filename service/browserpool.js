const puppeteer = require('puppeteer')
const genericPool = require('generic-pool')

const browserConfig = {
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
}

let browserPool

const initializeBrowserPool = async () => {
  browserPool = genericPool.createPool(
    {
      create: async () => await puppeteer.launch(browserConfig),
      destroy: async (browser) => await browser.close(),
    },
    {
      min: 2,
      max: 10,
      acquireTimeoutMillis: 60000,
      idleTimeoutMillis: 300000, // Close idle browsers after 5 minutes
      evictionRunIntervalMillis: 60000, // Run eviction checks every minute
    }
  )

  // Pre-create the minimum number of browsers
  const initialBrowsers = Array(2).fill().map(() => browserPool.acquire())
  await Promise.all(initialBrowsers)
  initialBrowsers.forEach(browserPromise => browserPromise.then(browser => browserPool.release(browser)))

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
