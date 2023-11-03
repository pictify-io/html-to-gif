const fp = require('fastify-plugin')
const AuthToken = require('../../models/AuthToken');
const ApiToken = require('../../models/ApiToken');
const uid = require('../../util/uid');

const cookieOptions = {
    domain: process.env.NODE_ENV === 'production' ? 'https://www.example.com' : 'localhost',
    path: '/',
    httpOnly: true,
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // 7 days
    secure: false,
}


module.exports = fp(async (fastify, opts) => {
    fastify.decorateReply('loginCallback', async function ({ user, payload }) {
        const userUid = await uid();
        const authToken = new AuthToken({ user: user._id, uid: userUid });
        const apiToken = new ApiToken({ user: user._id });
        await Promise.all([authToken.save(), apiToken.save()]);
        this.setCookie('auth-token', authToken.uid, cookieOptions).code(200).send(payload)
    });
    fastify.decorateReply('logout', function ({ payload }) {
        this.clearCookie('auth-token', cookieOptions).code(200).send(payload);
    });
});





