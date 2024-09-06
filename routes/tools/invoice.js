const fs = require('fs');
const path = require('path');

const getAllTemplates = async (req, res) => {
  const templates = fs.readdirSync(path.join(__dirname, '../../templates', 'invoice'));
  return res.send(templates);
}

const getInvoiceTemplate = async (req, res) => {
  const { template } = req.params;
  const templatePath = path.join(__dirname, '../../templates', 'invoice', `${template}`);
  if (!fs.existsSync(templatePath)) {
    return res.status(404).send({ message: 'Template not found' });
  }
  const html = fs.readFileSync(templatePath, 'utf-8');
  return res.type('text/html').send(html);
}

module.exports = async (fastify) => {
  fastify.get('/templates/invoice/all', getAllTemplates);
  fastify.get('/templates/invoice/:template', getInvoiceTemplate);
}

module.exports.autoPrefix = '/api/tools';
