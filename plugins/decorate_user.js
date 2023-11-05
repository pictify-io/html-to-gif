const fp = require('fastify-plugin')
const User = require('../models/User');
const AuthToken = require('../models/AuthToken');

const parseCookie = (cookie) => {
    const cookies = cookie.split(';')
    const cookieObj = cookies.reduce((acc, cookie) => {
        const [key, value] = cookie.split('=')
        return { ...acc, [key.trim()]: value }
    }, {})
    return cookieObj
}

const decorateUser = async (request, reply) => {
    const { cookie } = request.headers;
    if (!cookie) {
        reply.code(401).send({ message: 'Invalid Request' })
    }
    const authTokens = parseCookie(request.headers.cookie);

    if (!authTokens && !authTokens['auth-token']) {
        reply.code(401).send({ message: 'Invalid Request' })

    }
    const authToken = await AuthToken.findOne({ uid: authTokens['auth-token'] }).populate('user');

    if (!authToken) {
        reply.code(401).send({ message: 'Invalid Request' })
    }
    if (!authToken.isValid()) {
        reply.code(401).send({ message: 'Invalid Request' })
    }
    await authToken.refresh();
    request.user = authToken.user;
}

module.exports = fp(async (fastify, opts) => {
    fastify.decorateRequest('user', null);
    fastify.addHook('preHandler', decorateUser);
});

