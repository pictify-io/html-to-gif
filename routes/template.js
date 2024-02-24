const Template = require('../models/template');
const decorateUser = require('../plugins/decorate_user');
const verifyApiToken = require('../plugins/verify_api_token');

const getTemplates = async (req, res) => {
    const { user } = req;
    const templates = await Template.find({ createdBy: user._id });
    return res.send({ templates });
}

const createTemplate = async (req, res) => {
    const { user } = req;

    const { html, name, grapeJSData, width, height } = req.body;
    const variables = [];
    const variableRegex = /{{(.*?)}}/g;
    let match;
    while (match = variableRegex.exec(html)) {
        variables.push(match[1]);
    }
    const template = await Template.create(
        { html, variables, grapeJSData, width, height, createdBy: user._id, name });
    return res.send({ template });
}

const getTemplate = async (req, res) => {
    const { user } = req;
    const { uid } = req.params;
    const template = await Template.findOne({ uid, createdBy: user._id });
    if (!template) {
        return res.status(404).send({ message: 'Template not found' });
    }
    return res.send({ template });
}

const updateTemplate = async (req, res) => {
    const { user } = req;
    const { uid } = req.params;
    const { html, variables, name, grapeJSData, width, height } = req.body;

    const template = await Template.findOneAndUpdate(
        { uid, createdBy: user._id },
        { html, variables, name, grapeJSData, width, height },
        { new: true }
    );

    if (!template) {
        return res.status(404).send({ message: 'Template not found' });
    }

    return res.send({ template });
}

const deleteTemplate = async (req, res) => {
    const { user } = req;
    const { uid } = req.params;
    const template = await Template.findOneAndUpdate({ uid, createdBy: user._id }, { active: false });
    if (!template) {
        return res.status(404).send({ message: 'Template not found' });
    }
    return res.send({ template });
}

const searchTemplates = async (req, res) => {
    // Search for substring in name
    const { user } = req;
    const { q } = req.query;
    const templates = await Template.find({ name: { $regex: q, $options: 'i' }, createdBy: user._id });
    return res.send({ templates });
}

module.exports = async (fastify) => {
    fastify.register(async (fastify) => {
        fastify.register(decorateUser);
        fastify.get('/search', searchTemplates);
        fastify.get('/', getTemplates);
        fastify.post('/', createTemplate);
        fastify.get('/:uid', getTemplate);
        fastify.put('/:uid', updateTemplate);
        fastify.delete('/:uid', deleteTemplate);
    });
}

module.exports.autoPrefix = '/templates';