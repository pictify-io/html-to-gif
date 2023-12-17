const puppeteer = require('puppeteer');
const sharp = require('sharp');
const fs = require('fs');
const { getUploadStream } = require('../service/aws');
const performance = require('perf_hooks').performance;

class WebImageCapture {
    constructor(url, html, selector, width, height) {
        this.url = url;
        this.selector = selector;
        this.width = width;
        this.height = height;
        this.outputPath = null;
        this.html = html;
    }

    async setupBrowser() {
        const browserConfig = {
            headless: 'new',
        };
        if (this.width && this.height) {
            browserConfig.defaultViewport = { width: this.width, height: this.height };
        }
        this.browser = await puppeteer.launch(browserConfig);
        this.page = await this.browser.newPage();
        if (this.html) { await this.page.setContent(this.html, { waitUntil: 'load' }) }
        else {
            await this.page.goto(this.url, { waitUntil: 'load' });
        }
    }

    async calculateMaxBounds() {
        await this.page.waitForSelector(this.selector || 'body', { visible: true, timeout: 10000 });

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
        await this.browser.close();
    }
}

async function captureImages({
    url,
    selector,
    width,
    height,
    html
}) {
    const capturer = new WebImageCapture(url, html, selector, width, height);
    await capturer.setupBrowser();
    const maxBounds = await capturer.calculateMaxBounds();
    capturer.width = maxBounds.width;
    capturer.height = maxBounds.height;
    await capturer.captureImages();
    capturer.close();
    const metadata = {
        width: capturer.width,
        height: capturer.height,
    };
    return {
        url: capturer.outputPath,
        metadata,
    };
}

module.exports = captureImages;
