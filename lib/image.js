const puppeteer = require('puppeteer')
const sharp = require('sharp')
const { getUploadStream } = require('../service/aws')
const performance = require('perf_hooks').performance

class WebImageCapture {
  constructor(url, html, selector, width, height, page, fileExtension) {
    this.url = url
    this.selector = selector
    this.width = width
    this.height = height
    this.outputPath = null
    this.html = html
    this.fileExtension = fileExtension || 'png'
    this.page = page
  }

  async setupBrowser() {
    if (!this.page) {
      throw new Error('Page instance required')
    }
    const blocked_domains = [
      'googlesyndication.com',
      'doubleclick.net',
      'google-analytics.com',
      'googletagmanager.com',
      'google.com/ads',
      'facebook.com',
      'twitter.com',
      'youtube.com',
      'analytics',
      'tracking',
    ]
    // Store request handler for cleanup
    this.requestHandler = request => {
      const url = request.url().toLowerCase()
      const resourceType = request.resourceType()

      // Block known ad/tracking domains
      if (blocked_domains.some(domain => url.includes(domain))) {
        request.abort()
        return
      }

      // Block media and other heavy resources that aren't needed for rendering
      if (['media', 'websocket', 'manifest', 'other'].includes(resourceType)) {
        request.abort()
        return
      }

      // Allow essential resources for proper rendering
      if (['document', 'stylesheet', 'font', 'image', 'script'].includes(resourceType)) {
        request.continue()
        return
      }

      // Block everything else
      request.abort()
    }

    // Optimize memory usage by blocking only non-essential resources
    // Only set up request interception if it's not already enabled
    if (!this.page.listenerCount('request')) {
      await this.page.setRequestInterception(true)
      this.page.on('request', this.requestHandler)
    }

    if (this.width && this.height) {
      await this.page.setViewport({
        width: this.width,
        height: this.height,
      })
    }

    const navigationOptions = {
      waitUntil: ['domcontentloaded', 'networkidle0'],
      timeout: 10000
    }

    if (this.html) {
      await this.page.setContent(this.html, navigationOptions)
    } else {
      if (this.page.url() !== this.url) {
        await this.page.goto(this.url, navigationOptions)
      }
    }
  }

  async calculateMaxBounds() {
    await this.page.waitForSelector(this.selector || 'body', {
      visible: true,
      timeout: 5000
    })

    let elements = []
    if (this.selector) {
      elements = await this.page.$$(this.selector)
    } else {
      elements = await this.page.$$('body > *:not(style):not(script)')
      const outerBoundingBox = await elements[0]?.boundingBox()
      if (outerBoundingBox?.width > 0 && outerBoundingBox?.height > 0) {
        this.selector = 'body > *:not(style):not(script)'
      } else {
        this.selector = 'html'
      }
    }

    const maxBounds = {
      width: 0,
      height: 0,
    }

    for (const element of elements) {
      const bbox = await element.boundingBox()
      if (bbox) {
        maxBounds.width = Math.max(maxBounds.width, bbox.x + bbox.width)
        maxBounds.height = Math.max(maxBounds.height, bbox.y + bbox.height)
      }
    }

    if (this.width && this.height) {
      maxBounds.width = Math.max(maxBounds.width, this.width)
      maxBounds.height = Math.max(maxBounds.height, this.height)
      this.selector = this.selector || 'html'
    }

    // Ensure dimensions are reasonable
    maxBounds.width = Math.min(Math.round(maxBounds.width), 4096)
    maxBounds.height = Math.min(Math.round(maxBounds.height), 4096)
    return maxBounds
  }

  async captureImages() {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Image capture timed out')), 10000)
    )

    try {
      await Promise.race([
        (async () => {
          await this.page.setViewport({ width: this.width, height: this.height })
          const element = await this.page.$(this.selector)
          if (!element) throw new Error('Element not found')

          const screenshot = await element.screenshot({
            type: this.fileExtension,
            omitBackground: true,
            encoding: 'binary',
          })

          const { writeStream, promise, key } = getUploadStream(this.fileExtension)

          // Optimize image processing
          await sharp(screenshot)
            .resize(Math.min(this.width, 2048), Math.min(this.height, 2048), {
              fit: 'inside',
              withoutEnlargement: true
            })
            .png({
              quality: 80,
              compressionLevel: 8,
              palette: true,
              colors: 256
            })
            .pipe(writeStream)

          await promise
          this.outputPath = `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${key}`
        })(),
        timeout
      ])
    } catch (error) {
      console.error('Error in captureImages:', error)
      throw error
    }
  }

  async cleanup() {
    try {
      if (this.page && !this.page.isClosed()) {
        // Remove request interception only if we added it
        if (this.requestHandler) {
          this.page.removeListener('request', this.requestHandler)
          // Only disable request interception if no other listeners remain
          if (this.page.listenerCount('request') === 0) {
            await this.page.setRequestInterception(false)
          }
        }
      }
    } catch (err) {
      console.error('Error during cleanup:', err)
    }
  }

  async close() {
    await this.cleanup()
  }
}

async function captureImages({ url, selector, width, height, html, page, fileExtension }) {
  if (!page) {
    throw new Error('Page instance required')
  }

  const capturer = new WebImageCapture(
    url,
    html,
    selector,
    width,
    height,
    page,
    fileExtension
  )

  try {
    await capturer.setupBrowser()
    const maxBounds = await capturer.calculateMaxBounds()
    capturer.width = maxBounds.width
    capturer.height = maxBounds.height
    await capturer.captureImages()

    const metadata = {
      width: capturer.width,
      height: capturer.height,
      uid: capturer.outputPath.split('/').pop().split('.')[0],
    }

    const mediaUrl = `https://${process.env.MEDIA_URL_HOST}/${metadata.uid}.${capturer.fileExtension}`

    return {
      url: mediaUrl,
      metadata,
    }
  } finally {
    // await capturer.close()
  }
}

// Test function to demonstrate fallback selector creation
function testFallbackSelector(selector) {
  const capturer = new WebImageCapture();
  const fallback = capturer.createFallbackSelector(selector);
  console.log(`Original: ${selector}`);
  console.log(`Fallback: ${fallback}`);
  return fallback;
}

module.exports = captureImages
module.exports.testFallbackSelector = testFallbackSelector
