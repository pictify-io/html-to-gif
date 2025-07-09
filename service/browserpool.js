const puppeteer = require('puppeteer')
const genericPool = require('generic-pool')

// Constants
const MAX_BROWSERS = 3;
const MIN_BROWSERS = 1;
const MAX_PAGES_PER_BROWSER = 10;
const BROWSER_TIMEOUT = 30000;
const BROWSER_HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
const MAX_BROWSER_IDLE_TIME = 300000; // 5 minutes
const MAX_BROWSER_ACQUISITION_TIME = 120000; // 2 minutes
const MAX_PAGE_REUSE = 50; // Maximum times a page can be reused before recycling

// Browser configuration
const browserConfig = {
  headless: 'new',
  args: [
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
    '--disable-web-security',
    '--enable-precise-memory-info',
    '--disable-features=site-per-process'
  ],
  defaultViewport: {
    width: 1280,
    height: 720
  }
};

class BrowserPool {
  constructor() {
    this.pool = null;
    this.pagesByBrowser = new Map();
    this.browserAcquisitionTimes = new Map();
    this.browserUsageCounts = new Map(); // Track browser usage
    this.browserLastUsed = new Map(); // Track last usage time
    this.healthCheckInterval = null;
    this.isHealthCheckRunning = false; // Prevent concurrent health checks
    this.browserMutex = new Map(); // Prevent concurrent operations on same browser
  }

  async initialize() {
    if (this.pool) {
      return;
    }

    this.pool = genericPool.createPool({
      create: async () => {
        const browser = await puppeteer.launch(browserConfig);
        this.pagesByBrowser.set(browser, new Set());
        this.browserUsageCounts.set(browser, 0);
        this.browserLastUsed.set(browser, Date.now());

        browser.on('disconnected', async () => {
          if (this.pagesByBrowser.has(browser)) {
            const pages = this.pagesByBrowser.get(browser);
            pages.clear();
            this.pagesByBrowser.delete(browser);
            this.browserAcquisitionTimes.delete(browser);
            this.browserUsageCounts.delete(browser);
            this.browserLastUsed.delete(browser);
            this.browserMutex.delete(browser);
          }
        });

        return browser;
      },
      destroy: async (browser) => {
        try {
          if (this.pagesByBrowser.has(browser)) {
            const pages = this.pagesByBrowser.get(browser);
            pages.clear();
            this.pagesByBrowser.delete(browser);
            this.browserAcquisitionTimes.delete(browser);
            this.browserUsageCounts.delete(browser);
            this.browserLastUsed.delete(browser);
            this.browserMutex.delete(browser);
          }
          await browser.close();
        } catch (err) {
          console.error('Error destroying browser:', err);
        }
      },
      validate: async (browser) => {
        try {
          return browser.connected;
        } catch (err) {
          return false;
        }
      },
    }, {
      min: MIN_BROWSERS,
      max: MAX_BROWSERS,
      acquireTimeoutMillis: BROWSER_TIMEOUT,
      evictionRunIntervalMillis: BROWSER_HEALTH_CHECK_INTERVAL,
      numTestsPerEvictionRun: MAX_BROWSERS,
      autostart: false,
      testOnBorrow: true
    });

    await this.pool.start();
    this.startHealthCheck();
  }

  async performHealthCheck() {
    // Prevent concurrent health checks
    if (this.isHealthCheckRunning) {
      return;
    }
    this.isHealthCheckRunning = true;

    try {
      const now = Date.now();

      // Check for stuck browsers (only those not currently being used)
      const stuckBrowsers = [];
      for (const [browser, acquisitionTime] of this.browserAcquisitionTimes.entries()) {
        if (now - acquisitionTime > MAX_BROWSER_ACQUISITION_TIME) {
          // Only mark as stuck if not currently being operated on
          if (!this.browserMutex.has(browser)) {
            stuckBrowsers.push(browser);
          }
        }
      }

      // Process stuck browsers
      for (const browser of stuckBrowsers) {
        console.warn('Found stuck browser, attempting recovery...');
        try {
          await this.releaseBrowser(browser);
          console.log('Successfully released stuck browser');
        } catch (error) {
          console.error('Failed to release stuck browser:', error);
          try {
            await this.pool.destroy(browser);
          } catch (destroyError) {
            console.error('Failed to destroy stuck browser:', destroyError);
          }
        }
      }

      // Check for idle browsers exceeding max idle time
      const idleBrowsers = [];
      for (const [browser, lastUsed] of this.browserLastUsed.entries()) {
        if (now - lastUsed > MAX_BROWSER_IDLE_TIME &&
          !this.browserAcquisitionTimes.has(browser) &&
          !this.browserMutex.has(browser)) {
          idleBrowsers.push(browser);
        }
      }

      // Process idle browsers
      for (const browser of idleBrowsers) {
        console.log('Recycling idle browser');
        try {
          await this.pool.destroy(browser);
        } catch (error) {
          console.error('Error recycling idle browser:', error);
        }
      }

      // Check pool saturation
      const stats = await this.getPoolStats();
      if (stats.size === MAX_BROWSERS && stats.available === 0) {
        console.warn('Browser pool saturated, attempting recovery...');
        try {
          // Find and recycle the most used browser (if not currently in use)
          let maxUsage = 0;
          let browserToRecycle = null;
          for (const [browser, count] of this.browserUsageCounts.entries()) {
            if (count > maxUsage &&
              !this.browserAcquisitionTimes.has(browser) &&
              !this.browserMutex.has(browser)) {
              maxUsage = count;
              browserToRecycle = browser;
            }
          }
          if (browserToRecycle) {
            await this.pool.destroy(browserToRecycle);
            console.log('Successfully recycled heavily used browser');
          }
        } catch (error) {
          console.error('Failed to recycle browser:', error);
        }
      }
    } finally {
      this.isHealthCheckRunning = false;
    }
  }

  async acquireBrowser() {
    if (!this.pool) {
      throw new Error('Browser pool not initialized');
    }

    const browser = await this.pool.acquire();
    this.browserAcquisitionTimes.set(browser, Date.now());
    this.browserUsageCounts.set(browser, (this.browserUsageCounts.get(browser) || 0) + 1);
    this.browserLastUsed.set(browser, Date.now());
    return browser;
  }

  async releaseBrowser(browser) {
    if (!this.pool) {
      throw new Error('Browser pool not initialized');
    }

    // Prevent concurrent operations on the same browser
    if (this.browserMutex.has(browser)) {
      await this.browserMutex.get(browser);
    }

    this.browserAcquisitionTimes.delete(browser);
    this.browserLastUsed.set(browser, Date.now());

    // If browser has been used too much, recycle it
    if (this.browserUsageCounts.get(browser) > MAX_PAGE_REUSE) {
      console.log('Recycling heavily used browser');
      await this.pool.destroy(browser);
      return;
    }

    // Always release back to pool to maintain proper state
    await this.pool.release(browser);
  }

  async cleanup() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.pool) {
      await this.pool.drain();
      await this.pool.clear();
      this.pagesByBrowser.clear();
      this.browserAcquisitionTimes.clear();
      this.browserUsageCounts.clear();
      this.browserLastUsed.clear();
      this.browserMutex.clear();
      this.pool = null;
    }
  }

  getPageCount(browser) {
    return this.pagesByBrowser.get(browser)?.size || 0;
  }

  trackPage(browser, page) {
    const pages = this.pagesByBrowser.get(browser);
    if (pages) {
      pages.add(page);
    }
  }

  untrackPage(browser, page) {
    const pages = this.pagesByBrowser.get(browser);
    if (pages) {
      pages.delete(page);
    }
  }

  async getPoolStats() {
    if (!this.pool) {
      return {
        size: 0,
        available: 0,
        borrowed: 0,
        pending: 0,
        max: MAX_BROWSERS,
        min: MIN_BROWSERS,
        pagesByBrowser: []
      };
    }

    const poolSize = this.pool.size;
    const available = this.pool.available;
    const borrowed = this.pool.borrowed;
    const pending = this.pool.pending;

    // Get page counts for each browser
    const pagesByBrowser = Array.from(this.pagesByBrowser.entries()).map(([browser, pages]) => ({
      connected: browser.connected,
      pageCount: pages.size
    }));

    return {
      size: poolSize,
      available,
      borrowed,
      pending,
      max: MAX_BROWSERS,
      min: MIN_BROWSERS,
      pagesByBrowser
    };
  }

  startHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        console.error('Error in browser pool health check:', error);
      }
    }, BROWSER_HEALTH_CHECK_INTERVAL);

    // Ensure the interval doesn't keep the process alive
    this.healthCheckInterval.unref();
  }
}

class PagePool {
  constructor(browserPool) {
    this.browserPool = browserPool;
    this.pool = null;
    this.pageAcquisitionTimes = new Map();
    this.pageUsageCounts = new Map(); // Track page usage
    this.pageLastUsed = new Map(); // Track last usage time
    this.healthCheckInterval = null;
    this.isHealthCheckRunning = false; // Prevent concurrent health checks
    // Use WeakMap to avoid circular references
    this.pageToBrowser = new WeakMap();
  }

  async initialize() {
    if (this.pool) {
      return;
    }

    this.pool = genericPool.createPool({
      create: async () => {
        const browser = await this.browserPool.acquireBrowser();
        let page = null;

        try {
          if (this.browserPool.getPageCount(browser) >= MAX_PAGES_PER_BROWSER) {
            throw new Error('Browser at max page capacity');
          }

          page = await browser.newPage();
          await page.setDefaultNavigationTimeout(BROWSER_TIMEOUT);
          await page.setDefaultTimeout(BROWSER_TIMEOUT);

          this.browserPool.trackPage(browser, page);
          // Use WeakMap instead of circular reference
          this.pageToBrowser.set(page, browser);
          this.pageUsageCounts.set(page, 0);
          this.pageLastUsed.set(page, Date.now());

          page.on('error', async () => {
            await this.destroyPage(page).catch(console.error);
          });

          return page;
        } catch (err) {
          // Only release browser if page creation failed
          if (!page) {
            await this.browserPool.releaseBrowser(browser);
          }
          throw err;
        }
      },
      destroy: async (page) => {
        await this.destroyPage(page);
      },
      validate: async (page) => {
        try {
          await page.evaluate(() => true);
          const usageCount = this.pageUsageCounts.get(page) || 0;
          return usageCount < MAX_PAGE_REUSE; // Recycle pages that have been used too much
        } catch (err) {
          return false;
        }
      }
    }, {
      max: MAX_BROWSERS * MAX_PAGES_PER_BROWSER,
      min: MIN_BROWSERS, // More balanced configuration
      acquireTimeoutMillis: BROWSER_TIMEOUT,
      evictionRunIntervalMillis: BROWSER_HEALTH_CHECK_INTERVAL,
      numTestsPerEvictionRun: Math.min(10, MAX_BROWSERS * MAX_PAGES_PER_BROWSER), // Reasonable test count
      autostart: false,
      testOnBorrow: true
    });

    await this.pool.start();
    this.startHealthCheck();
  }

  async acquirePage() {
    if (!this.pool) {
      throw new Error('Page pool not initialized');
    }
    const page = await this.pool.acquire();
    this.pageAcquisitionTimes.set(page, Date.now());
    this.pageUsageCounts.set(page, (this.pageUsageCounts.get(page) || 0) + 1);
    this.pageLastUsed.set(page, Date.now());
    return page;
  }

  async releasePage(page) {
    if (!this.pool) {
      throw new Error('Page pool not initialized');
    }
    this.pageAcquisitionTimes.delete(page);
    this.pageLastUsed.set(page, Date.now());

    // If page has been used too much, destroy it
    if (this.pageUsageCounts.get(page) >= MAX_PAGE_REUSE) {
      await this.destroyPage(page);
      return;
    }

    await this.pool.release(page);
  }

  async performHealthCheck() {
    // Prevent concurrent health checks
    if (this.isHealthCheckRunning) {
      return;
    }
    this.isHealthCheckRunning = true;

    try {
      const now = Date.now();

      // Check for stuck pages
      const stuckPages = [];
      for (const [page, acquisitionTime] of this.pageAcquisitionTimes.entries()) {
        if (now - acquisitionTime > MAX_BROWSER_ACQUISITION_TIME) {
          stuckPages.push(page);
        }
      }

      // Process stuck pages
      for (const page of stuckPages) {
        console.warn('Found stuck page, attempting recovery...');
        try {
          await this.releasePage(page);
          console.log('Successfully released stuck page');
        } catch (error) {
          console.error('Failed to release stuck page:', error);
          try {
            await this.destroyPage(page);
          } catch (destroyError) {
            console.error('Failed to destroy stuck page:', destroyError);
          }
        }
      }

      // Check for pages that have been used too much
      const overusedPages = [];
      for (const [page, usageCount] of this.pageUsageCounts.entries()) {
        if (usageCount >= MAX_PAGE_REUSE) {
          overusedPages.push(page);
        }
      }

      // Process overused pages
      for (const page of overusedPages) {
        console.log('Recycling heavily used page');
        try {
          await this.destroyPage(page);
        } catch (error) {
          console.error('Error recycling used page:', error);
        }
      }

      // Check pool saturation
      const stats = await this.getPoolStats();
      if (stats.size === MAX_BROWSERS * MAX_PAGES_PER_BROWSER && stats.available === 0) {
        console.warn('Page pool saturated, attempting recovery...');
        try {
          // Only destroy truly stuck pages, not all acquired pages
          const trulyStuckPages = Array.from(this.pageAcquisitionTimes.entries())
            .filter(([page, time]) => now - time > MAX_BROWSER_ACQUISITION_TIME * 2)
            .map(([page]) => page);

          for (const page of trulyStuckPages) {
            await this.destroyPage(page);
          }
          console.log(`Successfully cleaned up ${trulyStuckPages.length} stuck pages`);
        } catch (error) {
          console.error('Failed to clean up stuck pages:', error);
        }
      }
    } finally {
      this.isHealthCheckRunning = false;
    }
  }

  async destroyPage(page) {
    try {
      const browser = this.pageToBrowser.get(page);
      if (browser) {
        this.browserPool.untrackPage(browser, page);
        this.pageAcquisitionTimes.delete(page);
        this.pageUsageCounts.delete(page);
        this.pageLastUsed.delete(page);
        this.pageToBrowser.delete(page);
        await page.close().catch(console.error);
        await this.browserPool.releaseBrowser(browser);
      }
    } catch (err) {
      console.error('Error destroying page:', err);
    }
  }

  async cleanup() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.pool) {
      await this.pool.drain();
      await this.pool.clear();
      this.pageAcquisitionTimes.clear();
      this.pageUsageCounts.clear();
      this.pageLastUsed.clear();
      this.pageToBrowser = new WeakMap();
      this.pool = null;
    }
  }

  async getPoolStats() {
    if (!this.pool) {
      return {
        size: 0,
        available: 0,
        borrowed: 0,
        pending: 0,
        max: MAX_BROWSERS * MAX_PAGES_PER_BROWSER,
        min: MIN_BROWSERS
      };
    }

    const poolSize = this.pool.size;
    const available = this.pool.available;
    const borrowed = this.pool.borrowed;
    const pending = this.pool.pending;

    return {
      size: poolSize,
      available,
      borrowed,
      pending,
      max: MAX_BROWSERS * MAX_PAGES_PER_BROWSER,
      min: MIN_BROWSERS,
      activePages: this.pageAcquisitionTimes.size
    };
  }

  startHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        console.error('Error in page pool health check:', error);
      }
    }, BROWSER_HEALTH_CHECK_INTERVAL);

    // Ensure the interval doesn't keep the process alive
    this.healthCheckInterval.unref();
  }
}

// Create singleton instances
const browserPool = new BrowserPool();
const pagePool = new PagePool(browserPool);

// Handle process termination
['SIGINT', 'SIGTERM', 'exit'].forEach(signal => {
  process.once(signal, async () => {
    await pagePool.cleanup();
    await browserPool.cleanup();
    process.exit(0);
  });
});

module.exports = {
  initializeBrowserPool: async () => {
    await browserPool.initialize();
    await pagePool.initialize();
    console.log('Browser and page pools initialized');
  },
  acquirePage: () => pagePool.acquirePage(),
  releasePage: (page) => pagePool.releasePage(page),
  getPoolStats: async () => ({
    browserPool: await browserPool.getPoolStats(),
    pagePool: await pagePool.getPoolStats()
  }),

  cleanup: async () => {
    await pagePool.cleanup();
    await browserPool.cleanup();
  }
};

