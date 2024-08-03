const fs = require('fs').promises
const path = require('path')

const templatePathMap = {
  IMAGE_GENERATED: '../templates/image-generated.html',
  GIF_GENERATED: '../templates/gif-generated.html',
}
const getTemplate = async (req, res) => {
  const { type, variables } = req.query
  const templatePath = templatePathMap[type]
  if (!templatePath) {
    return res.status(404).send({ error: 'Not found' })
  }
  let template = await fs.readFile(path.join(__dirname, templatePath), 'utf8')
  const variablesMap = JSON.parse(variables)
  const variableKeys = Object.keys(variablesMap)
  variableKeys.forEach((key) => {
    const value = variablesMap[key]
    template = template.replaceAll(`{{${key}}}`, value)
  })
  return res.send({ template })
}

module.exports = async (fastify) => {
  fastify.register(async (fastify) => {
    fastify.get('/template', getTemplate)
  })
}

module.exports.autoPrefix = '/fe'
