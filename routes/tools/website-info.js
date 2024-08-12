const getWebsiteData = require('../../lib/og-image');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// Create a single browser instance
let browser;

// Initialize the browser when the module is loaded
(async () => {
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
})();

const websiteInfo = async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).send({ message: 'URL is required' });
  }

  try {
    const data = await getWebsiteData({ url, browser });
    return res.send(data);
  } catch (err) {
    console.error('Error in websiteInfo:', err);
    return res.status(500).send({ error: 'Something went wrong' });
  }
}

const getTemplate = async (req, res) => {
  const { template } = req.query;
  if (!template) {
    return res.status(400).send({ message: 'Template is required' });
  }
  const templatePath = path.join(__dirname, '../../templates', 'og-image', `${template}.html`);
  console.log(templatePath);
  if (!fs.existsSync(templatePath)) {
    return res.status(404).send({ message: 'Template not found' });
  }

  const html = fs.readFileSync(templatePath, 'utf-8');

  return res.type('text/html').send(html);
}

const getAllTemplates = async (req, res) => {
  const templates = fs.readdirSync(path.join(__dirname, '../../templates', 'og-image'));
  return res.send(templates);
}

module.exports = async (fastify) => {
  fastify.get('/website-info', websiteInfo);
  fastify.get('/templates/og-image', getTemplate);
  fastify.get('/templates/og-image/all', getAllTemplates);

  // Close the browser when the server is shutting down
  fastify.addHook('onClose', async (instance, done) => {
    if (browser) {
      await browser.close();
    }
    done();
  });
}

module.exports.autoPrefix = '/api/tools';