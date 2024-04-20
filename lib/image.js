const puppeteer = require('puppeteer');
const sharp = require('sharp');
const { getUploadStream } = require('../service/aws');
const performance = require('perf_hooks').performance;

class WebImageCapture {
    constructor(url, html, selector, width, height, browser) {
        this.url = url;
        this.selector = selector;
        this.width = width;
        this.height = height;
        this.outputPath = null;
        this.html = html;
        this.browser = browser;
    }

    async setupBrowser() {
        const browserConfig = {
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        };

        if (!this.browser) {
            this.browser = await puppeteer.launch(browserConfig);
        }

        this.page = await this.browser.newPage();

        if (this.width && this.height) {
            await this.page.setViewport({ width: this.width, height: this.height });
        }

        if (this.html) { await this.page.setContent(this.html, { waitUntil: 'networkidle0' }) }
        else {
            await this.page.goto(this.url, { waitUntil: 'networkidle0' });
        }
    }

    async calculateMaxBounds() {
        await this.page.waitForSelector(this.selector || 'body', { visible: true });

        let elements = [];
        if (this.selector) {
            elements = await this.page.$$(this.selector);
        } else {
            // get outermost element
            elements = await this.page.$$('body > *:not(style):not(script)');
            this.selector = 'body > *:not(style):not(script)';
        }

        let maxBounds = {
            width: 0,
            height: 0,
        };

        const boundingBoxes = await Promise.all(elements.map(element => element.boundingBox()));
        boundingBoxes.forEach(bbox => {
            if (bbox) {
                maxBounds.width = Math.max(maxBounds.width, bbox.x + bbox.width);
                maxBounds.height = Math.max(maxBounds.height, bbox.y + bbox.height);
            }
        });

        if (this.width && this.height) {
            maxBounds.width = Math.max(maxBounds.width, this.width);
            maxBounds.height = Math.max(maxBounds.height, this.height);
            this.selector = this.selector || 'html';
        }
        maxBounds.width = Math.round(maxBounds.width);
        maxBounds.height = Math.round(maxBounds.height);
        return maxBounds;
    }

    async captureImages() {
        // await this.page.waitForSelector(this.selector, { visible: true, timeout: 10000 });

        await this.page.setViewport({ width: this.width, height: this.height });
        const elements = await this.page.$$(this.selector);

        const element = elements[0];
        // HTML of the element
        const screenshot = await element.screenshot();
        const { writeStream, promise, key } = getUploadStream('png');

        sharp(screenshot)
            .png({ quality: 100 })
            .pipe(writeStream);

        const t0 = performance.now();
        await promise;
        const t1 = performance.now();
        console.log(`Upload time: ${t1 - t0} ms`);
            this.outputPath = `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${key}`;
        console.log(this.outputPath);
    }

    async close() {
        await this.page.close();
    }
}

async function captureImages({
    url,
    selector,
    width,
    height,
    html,
    browser
}) {
    console.log('Capturing images');

    if (browser) {
        browser = await browser;
    }
    const capturer = new WebImageCapture(url, html, selector, width, height, browser);
    const t0 = performance.now();
    await capturer.setupBrowser();
    const t1 = performance.now();
    console.log(`Setup time: ${t1 - t0} ms`);
    const maxBounds = await capturer.calculateMaxBounds();
    capturer.width = maxBounds.width;
    capturer.height = maxBounds.height;
    await capturer.captureImages();
    capturer.close();
    const metadata = {
        width: capturer.width,
        height: capturer.height,
        uid: capturer.outputPath.split('/').pop().split('.')[0],
    };

    const mediaUrl = `https://${process.env.MEDIA_URL_HOST}/${metadata.uid}.png`

    return {
        url: mediaUrl,
        metadata,
    };
}

module.exports = captureImages;
