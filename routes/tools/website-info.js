const getWebsiteData = require('../../lib/og-image');
const fs = require('fs');
const path = require('path');

const puppeteer = require('puppeteer');

const browserConfig = {
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
};

const browser = puppeteer.launch(browserConfig);

const websiteInfo = async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).send({ message: 'URL is required' });
  }
  let data;

  try {
    data = await getWebsiteData({
      url,
      browser,
    });
  } catch (err) {
    console.log(err);
    return res.status(500).send({ error: 'Something went wrong' });
  }
  return res.send(data);
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
}


module.exports.autoPrefix = '/api/tools';