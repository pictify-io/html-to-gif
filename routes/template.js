const Template = require('../models/template');
const decorateUser = require('../plugins/decorate_user');

const getTemplates = async (req, res) => {
    const { user } = req;
    const templates = await Template.find({ createdBy: user._id });
    return res.send({ templates });
}

const createTemplate = async (req, res) => {
    const { user } = req;
    const { html, variables, name } = req.body;
    const template = await Template.create({ html, variables, createdBy: user._id, name });
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
    const { html, variables, name } = req.body;
    const template = await Template.findOneAndUpdate({ uid, createdBy: user._id }, { html, variables, name });
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

module.exports = async (fastify) => {
    fastify.register(decorateUser);
    fastify.get('/', getTemplates);
    fastify.post('/', createTemplate);
    fastify.get('/:uid', getTemplate);
    fastify.put('/:uid', updateTemplate);
    fastify.delete('/:uid', deleteTemplate);
}

module.exports.autoPrefix = '/api/templates';