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

const decorateUser = async (request, reply, done) => {
    const { cookies } = request.headers;
    if (!cookies) {
        reply.send({ message: 'Invalid Request' }).status(401);
    }
    const authTokens = parseCookie(request.headers.cookie);

    if (!authTokens || !authTokens['auth-token']) {
        reply.send({ message: 'Invalid Request' }).status(401);
    }
    const authToken = await AuthToken.findOne({ uid: cookies['auth-token'] }).populate('user');
    if (!authToken) {
        reply.send({ message: 'Invalid Request' }).status(401);
    }
    if (!authToken.isValid()) {
        reply.send({ message: 'Invalid Request' }).status(401);
    }
    await authToken.refresh();
    request.user = authToken.user;
    done();
}

module.exports = fp(async (fastify, opts) => {
    fastify.decorateRequest('user', null);
    fastify.addHook('preHandler', decorateUser);
});

