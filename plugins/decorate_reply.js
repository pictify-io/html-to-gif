const fp = require('fastify-plugin')
const AuthToken = require('../models/AuthToken');

const cookieOptions = {
    domain: process.env.NODE_ENV === 'production' ? 'https://www.example.com' : 'localhost',
    path: '/',
    httpOnly: true,
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // 7 days
    secure: false,
}

const decorateReply = fp(async (fastify, opts) => {
    fastify.decorateReply('loginCallback', async function (user) {
        const authToken = new AuthToken({ user: user._id });
        await authToken.save();
        this.setCookie('auth-token', authToken.uid, cookieOptions);
        return user;
    })
});

module.exports = decorateReply;




