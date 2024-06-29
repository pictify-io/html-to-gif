const fp = require('fastify-plugin')
const AuthToken = require('../../models/AuthToken');
const ApiToken = require('../../models/ApiToken');
const uid = require('../../util/uid');

const cookieOptions = {
    domain: process.env.FRONTEND_HOST,
    httpOnly: true,
    secure: true,
}


module.exports = fp(async (fastify, opts) => {
    fastify.decorateReply('loginCallback', async function ({ user, payload, isHTML = false }) {
        cookieOptions.expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days
        const userUid = await uid();
        const authToken = new AuthToken({ user: user._id, uid: userUid });
        await authToken.save();
        console.log(this.setCookie);
        this.setCookie('auth-token', authToken.uid, cookieOptions).type('application/json').code(200).send({ success: true, payload });
    });
    fastify.decorateReply('logout', function ({ payload }) {
        this.clearCookie('auth-token', cookieOptions).code(200).send(payload);
    });
});





