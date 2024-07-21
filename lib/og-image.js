const puppeteer = require('puppeteer');
const { getPaletteFromURL } = require('color-thief-node');
const path = require('path');
const fs = require('fs');

class WebsiteData {
  constructor(url, browser) {
    this.url = url;
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
    await this.page.goto(this.url);
    console.log('Browser setup complete');
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

  // For a blog page
  // async getAuthor() {
  //   const authorInfo = await this.page.evaluate(() => {
  //     const keywords = ['author', 'writer', 'by', 'written', 'posted'];
  //     const textTags = ['p', 'span', 'div', 'a'];
  //     const authorImageSelectors = ['img[alt*="author"]', 'img[alt*="Author"]', 'img[src*="author"]'];

  //     let authorText = null;
  //     for (const tag of textTags) {
  //       const elements = Array.from(document.querySelectorAll(tag));
  //       const found = elements.find(el => keywords.some(keyword => el.innerText.toLowerCase().includes(keyword)));
  //       if (found) {
  //         authorText = found.innerText;
  //         break; // Exit loop once an author is found
  //       }
  //     }

  //     let authorImageUrl = null;
  //     for (const selector of authorImageSelectors) {
  //       const image = document.querySelector(selector);
  //       if (image) {
  //         authorImageUrl = image.src;
  //         break; // Exit loop once an image is found
  //       }
  //     }

  //     return { authorText, authorImageUrl };
  //   });

  //   return authorInfo;
  // }

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
    const imagePath = path.join(__dirname, 'page-preview', `screenshot-${Date.now()}.png`);
    await this.page.screenshot({
      path: imagePath,
    })
    const color = await getPaletteFromURL(imagePath);
    fs.unlinkSync(imagePath);
    return color;
  }
}


const getWebsiteData = async ({
  url,
  browser,
}) => {
  if (browser) {
    browser = await browser;
  }
  const websiteData = new WebsiteData(url, browser);
  await websiteData.setupBrowser();
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
}

module.exports = getWebsiteData;
