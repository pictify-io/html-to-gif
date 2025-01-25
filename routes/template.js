const Template = require('../models/Template')
const decorateUser = require('../plugins/decorate_user')

const templateSchema = {
  type: 'object',
  properties: {
    html: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string' },
    grapeJSData: { type: 'object' },
    createdAt: { type: 'string' },
    variables: { type: 'array', items: { type: 'string' } },
    uid: { type: 'string' },
    width: { type: 'number' },
    height: { type: 'number' },
  },
}

const getTemplatesSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        templates: {
          type: 'array',
          items: templateSchema,
        },
      },
    },
  },
}

const createTemplateSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        template: templateSchema,
      },
    },
  },
}

const getTemplateSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        template: templateSchema,
      },
    },
  },
}

const updateTemplateSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        template: templateSchema,
      },
    },
  },
}

const deleteTemplateSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
  },
}

const searchTemplatesSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        templates: {
          type: 'array',
          items: templateSchema,
        },
      },
    },
  },
}

const getTemplatesForTypeSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        templates: { type: 'array', items: templateSchema },
      },
    },
  },
}

const getTemplates = async (req, res) => {
  const { user } = req
  const templates = await Template.find({ createdBy: user._id })
  return res.send({ templates })
}

const createTemplate = async (req, res) => {
  const { user } = req

  const { html, name, grapeJSData, width, height, type } = req.body
  const variables = []
  const variableRegex = /{{(.*?)}}/g
  let match
  while ((match = variableRegex.exec(html))) {
    variables.push(match[1])
  }
  const template = await Template.create({
    html,
    variables,
    grapeJSData,
    width,
    height,
    createdBy: user._id,
    name,
    type,
  })
  return res.send({ template })
}

const getTemplate = async (req, res) => {
  const { user } = req
  const { uid } = req.params
  const template = await Template.findOne({ uid, createdBy: user._id })
  if (!template) {
    return res.status(404).send({ message: 'Template not found' })
  }
  return res.send({ template })
}

const updateTemplate = async (req, res) => {
  const { user } = req
  const { uid } = req.params
  const { html, variables, name, grapeJSData, width, height } = req.body

  const template = await Template.findOneAndUpdate(
    { uid, createdBy: user._id },
    { html, variables, name, grapeJSData, width, height },
    { new: true }
  )

  if (!template) {
    return res.status(404).send({ message: 'Template not found' })
  }

  return res.send({ template })
}

const deleteTemplate = async (req, res) => {
  const { user } = req
  const { uid } = req.params
  const template = await Template.findOneAndUpdate(
    { uid, createdBy: user._id },
    { active: false }
  )
  if (!template) {
    return res.status(404).send({ message: 'Template not found' })
  }
  return res.send({ message: 'Template deleted successfully' })
}

const searchTemplates = async (req, res) => {
  // Search for substring in name
  const { user } = req
  const { q } = req.query
  const templates = await Template.find({
    name: { $regex: q, $options: 'i' },
    createdBy: user._id,
  })
  return res.send({ templates })
}

const getTemplatesForType = async (req, res) => {
  const { user } = req
  const { type } = req.params
  const templates = await Template.find({ type, createdBy: user._id })
  return res.send({ templates })
}

module.exports = async (fastify) => {
  fastify.register(async (fastify) => {
    fastify.register(decorateUser)
    fastify.get('/search', { schema: searchTemplatesSchema }, searchTemplates)
    fastify.get('/', { schema: getTemplatesSchema }, getTemplates)
    fastify.post('/', { schema: createTemplateSchema }, createTemplate)
    fastify.get('/:uid', { schema: getTemplateSchema }, getTemplate)
    fastify.put('/:uid', { schema: updateTemplateSchema }, updateTemplate)
    fastify.delete('/:uid', { schema: deleteTemplateSchema }, deleteTemplate)
    fastify.get('/type/:type', { schema: getTemplatesForTypeSchema }, getTemplatesForType)
  })
}

module.exports.autoPrefix = '/templates'
