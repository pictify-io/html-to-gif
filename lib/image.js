const puppeteer = require('puppeteer');
const sharp = require('sharp');
const fs = require('fs');
const { getUploadStream } = require('../service/aws');

class WebImageCapture {
    constructor(url, html, selector, width, height) {
        this.url = url;
        this.selector = selector || 'html';
        this.width = width;
        this.height = height;
        this.outputPath = null;
        this.html = html;
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
        if (this.html) {
            await this.page.setContent(this.html, { waitUntil: 'networkidle2' });
        }
        if (this.url) {
        await this.page.goto(this.url, { waitUntil: 'networkidle2' });
        }
        await this.page.waitForSelector(this.selector, { visible: true, timeout: 10000 });

        const elements = await this.page.$$(this.selector);
        console.log(elements.length);

        for (let i = 0; i < elements.length; i++) {
            const element = elements[i];
            const screenshot = await element.screenshot();
            const resizedScreenshot = await sharp(screenshot)
                .png({ quality: 100, palette: true })
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
    html
}) {
    const capturer = new WebImageCapture(url, html, selector, width, height);
    await capturer.setupBrowser();
    if (!width || !height) {
        const maxBounds = await capturer.calculateMaxBounds();
        capturer.width = maxBounds.width;
        capturer.height = maxBounds.height;
    }
    await capturer.captureImages();
    await capturer.close();
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
