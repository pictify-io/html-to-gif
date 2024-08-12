const puppeteer = require('puppeteer');
const { getPaletteFromURL } = require('color-thief-node');
const path = require('path');
const fs = require('fs');

class WebsiteData {
  constructor(url, page) {
    this.url = url;
    this.page = page;
  }

  async setupPage() {
    await this.page.goto(this.url, { waitUntil: 'networkidle0', timeout: 30000 });
  }

  async getLogo() {
    const logoSelectors = [
      'img[alt*="logo"]',
      'img[alt*="Logo"]',
      'img[src*="logo"]',
      'img[src*="Logo"]',
      'img[class*="logo"]',
      'img[class*="Logo"]',
      '#logo img',
      '.logo img',
      'svg[aria-label*="logo"]',
      'svg[aria-label*="Logo"]',
      'svg[alt*="logo"]',
      'svg[alt*="Logo"]',
      'svg[src*="logo"]',
      'svg[src*="Logo"]',
      'svg[class*="logo"]',
      'svg[class*="Logo"]',
      '#logo svg',
      '.logo svg',
      'header svg',
      'nav svg',
      'svg:first-child',
      'header img',
      'nav img',
    ];

    for (const selector of logoSelectors) {
      const logo = await this.page.$(selector);
      if (logo) {
        const tagName = await this.page.evaluate((el) => el.tagName, logo);
        if (tagName === 'svg') {
          return await this.page.evaluate((el) => el.outerHTML, logo);
        }
        return await this.page.evaluate((el) => el.src, logo);
      }
    }
    return null;
  }

  async getHeading() {
    const headingSelectors = [
      'h1',
      'p[class*="title"]',
      'p[class*="heading"]',
      'p[class*="headline"]',
      'p[class*="subheading"]',
    ];

    for (const selector of headingSelectors) {
      const heading = await this.page.$(selector);
      if (heading) {
        const headingText = await this.page.evaluate((el) => el.innerText, heading);
        const headingColor = await this.page.evaluate((el) => getComputedStyle(el).color, heading);
        return { text: headingText, color: headingColor };
      }
    }
    return null
  }

  async getSubHeading() {
    const subHeadingSelectors = [
      'h2',
      'p[class*="subheading"]',
      'p[class*="subtitle"]',
      'p[class*="sub-title"]',
      'p[class*="sub-title"]',
    ];

    for (const selector of subHeadingSelectors) {
      const subHeading = await this.page.$(selector);
      if (subHeading) {
        return await this.page.evaluate((el) => el.innerText, subHeading);
      }
    }
    return null
  }

  async getHeadTagData() {
    return await this.page.evaluate(() => {
      const head = document.querySelector('head');
      if (!head) {
        return null;
      }
      const title = head.querySelector('title')?.innerText;
      const description = head.querySelector('meta[name="description"]')?.content;
      const keywords = head.querySelector('meta[name="keywords"]')?.content;
      const logo = head.querySelector('link[rel*="icon"]')?.href;

      return { title, description, keywords, logo };
    });
  }

  async getColorPalette() {
    const screenshotBuffer = await this.page.screenshot({ encoding: 'binary' });
    const color = await getPaletteFromURL(screenshotBuffer);
    return color;
  }

  async getCTAText() {
    const ctaSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'a.cta, a.btn-primary, a.button',
      'button.cta, button.btn-primary, button.primary',
      '[role="button"]',
      'button:not([type="reset"]):not([type="button"])',
      'a:not(.nav-link):not(.navbar-brand)',
    ];

    for (const selector of ctaSelectors) {
      const elements = await this.page.$$(selector);
      for (const element of elements) {
        const text = await this.page.evaluate(el => {
          const computedStyle = window.getComputedStyle(el);
          if (computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden' && el.offsetParent !== null) {
            const text = el.innerText;
            const color = el.style.color || computedStyle.color;
            const backgroundColor = el.style.backgroundColor || computedStyle.backgroundColor;

            if (text && text.trim().length > 0) {
              return { text: text.trim(), color, backgroundColor };
            }
          }
          return null;
        }, element);

        if (text) {
          return text;
        }
      }
    }

    return null;
  }
}

let browser;

const getWebsiteData = async ({ url, browser: existingBrowser }) => {
  if (!browser && !existingBrowser) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }

  const activeBrowser = existingBrowser || browser;
  const page = await activeBrowser.newPage();

  try {
    const websiteData = new WebsiteData(url, page);

    console.log('Setting up page...');
    await websiteData.setupPage();
    console.log('Page setup complete');

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