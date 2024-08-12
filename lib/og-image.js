const puppeteer = require('puppeteer');
const { getPaletteFromURL } = require('color-thief-node');

class WebsiteData {
  constructor(url, page) {
    this.url = url;
    this.page = page;
  }

  async setupPage() {
    // Remove request interception
    await this.page.setRequestInterception(false);

    // Set a more permissive Content Security Policy
    await this.page.setExtraHTTPHeaders({
      'Content-Security-Policy': "default-src * 'unsafe-inline' 'unsafe-eval'; img-src * data: blob:; script-src * 'unsafe-inline' 'unsafe-eval';"
    });

    // Navigate to the page with a longer timeout
    await this.page.goto(this.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
  }

  async getLogo() {
    const logoSelectors = [
      'img[alt*="logo" i], img[src*="logo" i], img[class*="logo" i], #logo img, .logo img',
      'svg[aria-label*="logo" i], svg[alt*="logo" i], svg[src*="logo" i], svg[class*="logo" i], #logo svg, .logo svg',
      'header svg, nav svg, svg:first-child, header img, nav img',
    ];

    for (const selector of logoSelectors) {
      const logo = await this.page.$(selector);
      if (logo) {
        const tagName = await logo.evaluate(el => el.tagName);
        return tagName === 'SVG' ?
          await logo.evaluate(el => el.outerHTML) :
          await logo.evaluate(el => el.src);
      }
    }
    return null;
  }

  async getHeading() {
    const headingSelectors = 'h1, p[class*="title" i], p[class*="heading" i], p[class*="headline" i], p[class*="subheading" i]';
    const heading = await this.page.$(headingSelectors);
    if (heading) {
      const [text, color] = await heading.evaluate(el => [
        el.innerText,
        getComputedStyle(el).color
      ]);
      return { text, color };
    }
    return null;
  }

  async getSubHeading() {
    const subHeadingSelectors = 'h2, p[class*="subheading" i], p[class*="subtitle" i], p[class*="sub-title" i]';
    const subHeading = await this.page.$(subHeadingSelectors);
    return subHeading ? await subHeading.evaluate(el => el.innerText) : null;
  }

  async getHeadTagData() {
    return this.page.evaluate(() => {
      const head = document.head;
      return {
        title: head.querySelector('title')?.innerText,
        description: head.querySelector('meta[name="description"]')?.content,
        keywords: head.querySelector('meta[name="keywords"]')?.content,
        logo: head.querySelector('link[rel*="icon"]')?.href,
      };
    });
  }

  async getColorPalette() {
    const screenshotBuffer = await this.page.screenshot({ encoding: 'binary', type: 'jpeg', quality: 80 });
    return getPaletteFromURL(screenshotBuffer);
  }
}

let browser;

const getWebsiteData = async ({ url, browser: existingBrowser }) => {
  if (!browser && !existingBrowser) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ],
    });
  }

  const activeBrowser = existingBrowser || browser;
  const page = await activeBrowser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  try {
    const websiteData = new WebsiteData(url, page);
    await websiteData.setupPage();

    const [data, logo, heading, subHeading, colors] = await Promise.all([
      websiteData.getHeadTagData(),
      websiteData.getLogo(),
      websiteData.getHeading(),
      websiteData.getSubHeading(),
      websiteData.getColorPalette(),
    ]);

    return {
      heading: heading?.text || data.title,
      subHeading: subHeading || data.description,
      logo: logo || data.logo,
      colors,
      headingColor: heading?.color,
    };
  } catch (error) {
    console.error('Error in getWebsiteData:', error);
    return {
      heading: 'Error occurred',
      subHeading: 'Unable to fetch website data',
      logo: null,
      colors: [],
      headingColor: null,
    };
  } finally {
    await page.close();
  }
}

module.exports = getWebsiteData;