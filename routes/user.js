const fastify = require('fastify');
const User = require('../models/User');
const ApiToken = require('../models/ApiToken');
const decorateUser = require('../plugins/decorate_user');


const getUser = async (req, res) => {
    const { user } = req;
    return res.send({ user });
}

const getUserPlanDetails = async (req, res) => {
    const { user } = req;
    const { monthlyLimit, hasExceededMonthlyLimit, usage, nextReset } = user.getPlanDetails();
    return res.send({ monthlyLimit, hasExceededMonthlyLimit, usage, nextReset });
}

const getUserApiTokens = async (req, res) => {
    const { user } = req;
    const apiTokens = await ApiToken.find({ user: user._id });
    return res.send({ apiTokens });
}

const createNewApiToken = async (req, res) => {
    const { user } = req;
    const apiToken = await ApiToken.create({ user: user._id });
    return res.send({ apiToken });
}

const deactivateApiToken = async (req, res) => {
    const { user } = req;
    const { uid } = req.params;
    const apiToken = await ApiToken.findOneAndUpdate({ uid, user: user._id }, { active: false });
    if (!apiToken) {
        return res.status(404).send({ message: 'Api token not found' });
    }
    return res.send({ apiToken });
}

module.exports = async (fastify) => {
    fastify.register(decorateUser);
    fastify.get('/', getUser);
    fastify.get('/api-tokens', getUserApiTokens);
    fastify.post('/api-tokens', createNewApiToken);
    fastify.delete('/api-tokens/:uid', deactivateApiToken);
    fastify.get('/plans', getUserPlanDetails);
}

module.exports.autoPrefix = '/api/users';
