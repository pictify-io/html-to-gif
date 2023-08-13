const puppeteer = require('puppeteer');
const sharp = require('sharp');
const fs = require('fs');
const { getUploadStream } = require('../service/aws');

class WebImageCapture {
    constructor(url, selector, width, height) {
        this.url = `file://${__dirname}/test-2.html`;
        this.selector = selector || 'html';
        this.width = width;
        this.height = height;
        this.outputPath = null;
    }

    async setupBrowser() {
        const browserConfig = {
            headless: true,
        };
        if (this.width && this.height) {
            browserConfig.defaultViewport = { width: this.width, height: this.height };
        }
        this.browser = await puppeteer.launch(browserConfig);
        this.page = await this.browser.newPage();
    }

    async calculateMaxBounds() {
        await this.page.goto(this.url, { waitUntil: 'networkidle2' });
        await this.page.waitForSelector(this.selector, { visible: true, timeout: 10000 });

        const elements = await this.page.$$(this.selector);
        let maxBounds = {
            width: 0,
            height: 0,
        };

        for (const element of elements) {
            const bbox = await element.boundingBox();
            if (bbox) {
                maxBounds.width = Math.max(maxBounds.width, bbox.x + bbox.width);
                maxBounds.height = Math.max(maxBounds.height, bbox.y + bbox.height);
            }
        }

        if (this.width && this.height) {
            maxBounds.width = Math.min(maxBounds.width, this.width);
            maxBounds.height = Math.min(maxBounds.height, this.height);
        }

        return maxBounds;
    }

    async captureImages() {
        await this.page.goto(this.url, { waitUntil: 'networkidle2' });
        await this.page.waitForSelector(this.selector, { visible: true, timeout: 10000 });

        const elements = await this.page.$$(this.selector);
        console.log(elements.length);

        for (let i = 0; i < elements.length; i++) {
            const element = elements[i];
            const screenshot = await element.screenshot();
            const resizedScreenshot = await sharp(screenshot)
                .resize(Math.round(this.width / 2.5), Math.round(this.height / 2.5))
                .png({ quality: 20, palette: true })
                .toBuffer()

            //Write to local storage
            fs.writeFileSync(`./screenshot-${i}.png`, resizedScreenshot);

            // Upload the screenshot to AWS or save to local storage
            const { writeStream, promise, key } = getUploadStream('png');
            const readStream = sharp(resizedScreenshot).pipe(writeStream);
            await promise;
            this.outputPath = `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${key}`;
        }
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
}) {
    const capturer = new WebImageCapture(url, selector, width, height);
    await capturer.setupBrowser();
    if (!width || !height) {
        const maxBounds = await capturer.calculateMaxBounds();
        capturer.width = maxBounds.width;
        capturer.height = maxBounds.height;
    }
    await capturer.captureImages();
    await capturer.close();
    return capturer.outputPath;
}

module.exports = captureImages;
