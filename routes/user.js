const fastify = require('fastify');
const User = require('../models/User');
const decorateUser = require('../plugins/decorate_user');


const getUser = async (req, res) => {
    const { user } = req;
    return res.send({ user });
}

module.exports = async (fastify) => {
    fastify.register(decorateUser);
    fastify.get('/', getUser);
}

module.exports.autoPrefix = '/api/users';
