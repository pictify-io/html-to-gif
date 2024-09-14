const puppeteer = require('puppeteer')
const sharp = require('sharp')
const { getUploadStream } = require('../service/aws')
const performance = require('perf_hooks').performance


class WebImageCapture {
  constructor(url, html, selector, width, height, browser, fileExtension) {
    this.url = url
    this.selector = selector
    this.width = width
    this.height = height
    this.outputPath = null
    this.html = html
    this.browser = browser
    this.fileExtension = fileExtension || 'png'
  }

  async setupBrowser() {
    const browserConfig = {
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }

    if (!this.browser) {
      this.browser = await puppeteer.launch(browserConfig)
    }

    this.page = await this.browser.newPage()

    if (this.width && this.height) {
      await this.page.setViewport({
        width: this.width,
        height: this.height,
      })
    }

    if (this.html) {
      await this.page.setContent(this.html, { waitUntil: 'networkidle0' })
    } else {
      await this.page.goto(this.url, { waitUntil: 'networkidle0' })
    }
  }

  async calculateMaxBounds() {
    console.log('Calculating max bounds')
    console.log('Selector', this.selector)
    await this.page.waitForSelector(this.selector || 'body', {
      visible: true,
    })
    console.log('Selector found')

    let elements = []
    if (this.selector) {
      elements = await this.page.$$(this.selector)
    } else {
      elements = await this.page.$$('body > *:not(style):not(script)')
      const outerBoundingBox = await elements[0].boundingBox()
      if (
        outerBoundingBox &&
        outerBoundingBox.width > 0 &&
        outerBoundingBox.height > 0
      ) {
        this.selector = 'body > *:not(style):not(script)'
      } else {
        this.selector = 'html'
      }
    }

    let maxBounds = {
      width: 0,
      height: 0,
    }

    const boundingBoxes = await Promise.all(
      elements.map((element) => element.boundingBox())
    )
    boundingBoxes.forEach((bbox) => {
      if (bbox) {
        maxBounds.width = Math.max(maxBounds.width, bbox.x + bbox.width)
        maxBounds.height = Math.max(maxBounds.height, bbox.y + bbox.height)
      }
    })

    if (this.width && this.height) {
      maxBounds.width = Math.max(maxBounds.width, this.width)
      maxBounds.height = Math.max(maxBounds.height, this.height)
      this.selector = this.selector || 'html'
    }
    maxBounds.width = Math.round(maxBounds.width)
    maxBounds.height = Math.round(maxBounds.height)
    return maxBounds
  }

  async captureImages() {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Image capture timed out')), 10000)
    );

    try {
      await Promise.race([
        (async () => {
          await this.page.setViewport({ width: this.width, height: this.height });
          const elements = await this.page.$$(this.selector);
          const element = elements[0];
          const screenshot = await element.screenshot({
            type: this.fileExtension,
            omitBackground: true,
            encoding: 'binary',
          });

          const { writeStream, promise, key } = getUploadStream(this.fileExtension);

          sharp(screenshot)
            .png({ quality: 80, compressionLevel: 8 })
            .pipe(writeStream);

          const t0 = performance.now();
          await promise;
          const t1 = performance.now();
          console.log(`Upload time: ${t1 - t0} ms`);
          this.outputPath = `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${key}`;
          console.log(this.outputPath);
        })(),
        timeout
      ]);
    } catch (error) {
      console.error('Error in captureImages:', error);
      throw error;
    }
  }

  async close() {
    await this.page.close()
  }
}

async function captureImages({ url, selector, width, height, html, browser, fileExtension }) {
  console.log('Capturing images')

  if (browser) {
    browser = await browser
  }
  const capturer = new WebImageCapture(
    url,
    html,
    selector,
    width,
    height,
    browser,
    fileExtension
  )
  const t0 = performance.now()
  await capturer.setupBrowser()
  const t1 = performance.now()
  console.log(`Setup time: ${t1 - t0} ms`)
  const maxBounds = await capturer.calculateMaxBounds()
  capturer.width = maxBounds.width
  capturer.height = maxBounds.height
  await capturer.captureImages()
  capturer.close()
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
}

module.exports = captureImages
