const createGif = require('../lib/gif');
const decorateUser = require('../plugins/decorate_user');
const verifyApiToken = require('../plugins/verify_api_token');
const Gif = require('../models/Gif');
const rateLimit = require('@fastify/rate-limit');

const puppeteer = require('puppeteer');

const browserConfig = {
    headless: 'new',
};

const browser = puppeteer.launch(browserConfig);

const createGifHandler = async (req, res) => {
    const { user } = req;
    const { html, url, width, height, framesPerSecond, selector } = req.body;
    let gif;
    try {
        const { url: gifLink, metadata } = await createGif({
            html,
            url,
            width,
            height,
            framesPerSecond,
            selector,
            browser
        });
        gif = {
            url: gifLink,
            ...metadata
        };
    }
    catch (err) {
        console.log(err);
        return res.status(500).send({ error: 'Something went wrong' });
    }

    if (!gif) {
        return res.status(500).send({ error: 'Something went wrong' });
    }

    gif = await Gif.create({
        url: gif.url,
        html,
        width: gif.width,
        height: gif.height,
        framesPerSecond: gif.framesPerSecond,
        animationLength: gif.animationLength,
        createdBy: user._id
    });

    return res.send({ gif });
}

const getUserGifsHandler = async (req, res) => {
    const { user } = req;
    let { limit, offset } = req.query;
    if (!limit) {
        limit = 30;
    }
    if (!offset) {
        offset = 0;
    }
    if (limit > 100) {
        limit = 100;
    }
    if (offset < 0) {
        offset = 0;
    }
    const gifs = await Gif.find({ createdBy: user._id }).limit(limit).skip(offset);
    return res.send({ gifs });
}

const getGifHandler = async (req, res) => {
    const { uid } = req.params;
    const gif = await Gif.findOne({ uid });
    if (!gif) {
        return res.status(404).send({ error: 'Not found' });
    }
    return res.send({ gif });
};

const createPublicGifHandler = async (req, res) => {
    const { html, url, width, height, framesPerSecond } = req.body;
    let gif;
    try {
        const { url: gifLink, metadata } = await createGif({
            html,
            url,
            width,
            height,
            framesPerSecond,
            browser
        });
        gif = {
            url: gifLink,
            ...metadata
        };
    }
    catch (err) {
        console.log(err);
        return res.status(500).send({ error: 'Something went wrong' });
    }

    if (!gif) {
        return res.status(500).send({ error: 'Something went wrong' });
    }

    gif = await Gif.create({
        url: gif.url,
        html,
        width: gif.width,
        height: gif.height,
        framesPerSecond: gif.framesPerSecond,
        animationLength: gif.animationLength,
        createdBy: 'public'
    });

    return res.send({ gif });
}

module.exports = async (fastify) => {
    fastify.register(async (fastify) => {
        fastify.register(verifyApiToken);
        fastify.post('/create', createGifHandler);
        fastify.get('/', getUserGifsHandler);
    })

    fastify.register(async (fastify) => {
        fastify.get('/:uid', getGifHandler);
    });

    fastify.register(async (fastify) => {
        await fastify.register(rateLimit, {
            max: 5,
            timeWindow: '1 minute',
            cache: 10000,
            allowList: [process.env.FRONTEND_IP]
        });

        fastify.post('/public', createPublicGifHandler);
        fastify.get('/public', (req, res) => {
            res.send({ message: 'Hello from public' });
        });
    });
};

module.exports.autoPrefix = '/api/gif';

