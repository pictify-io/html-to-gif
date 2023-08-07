require('dotenv').config();

const oauth2Plugin = require('@fastify/oauth2');
const AutoLoad = require('fastify-autoload');
const path = require('path');

const db = require('./db');

db();

const port = process.env.PORT || 3001;

const fastify = require('fastify')({
    logger: true
});

if (process.env.NODE_ENV !== 'production') {
    fastify.register(require('@fastify/cors'), {
        // put your options here
    });
}


fastify.register(oauth2Plugin, {
    name: 'googleOAuth2',
    scope: ['profile', 'email'],
    credentials: {
        client: {
            id: process.env.GOOGLE_CLIENT_ID,
            secret: process.env.GOOGLE_CLIENT_SECRET
        },
        auth: oauth2Plugin.GOOGLE_CONFIGURATION
    },
    startRedirectPath: '/login/google',
    callbackUri: process.env.NODE_ENV === 'production' ? 'https://www.example.com/login/google/callback' : 'http://localhost:3000/auth/google/callback',
    callbackUriParams: {
        access_type: 'offline'
    },
    generateStateFunction: (request) => {
        return 'SUYASH';
    },
    checkStateFunction: (returnedState, callback) => {
        callback();
    },
});

fastify.register(AutoLoad, {
    dir: path.join(__dirname, 'plugins', 'common'),
});

fastify.register(AutoLoad, {
    dir: path.join(__dirname, 'routes'),
});






fastify.listen({ port }, (err, address) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server listening on ${address}`);
});