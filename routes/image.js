const captureImages = require('../lib/image');
const verifyApiToken = require('../plugins/verify_api_token');
const Image = require('../models/Image');
const rateLimit = require('@fastify/rate-limit');

const puppeteer = require('puppeteer');

const browserConfig = {
    headless: 'new',
};

const browser = puppeteer.launch(browserConfig);


const createImageHandler = async (req, res) => {
    const { user } = req;
    const { html, url, width, height } = req.body;
    let image;
    try {
        const { url: imageLink, metadata } = await captureImages({
            html,
            url: imageLink,
            width,
            height,
            browser
        });
        image = {
            url,
            ...metadata
        };
    }
    catch (err) {
        console.log(err);
        return res.status(500).send({ error: 'Something went wrong' });
    }

    if (!image) {
        return res.status(500).send({ error: 'Something went wrong' });
    }

    image = await Image.create({
        url: image.url,
        html,
        width: image.width,
        height: image.height,
        createdBy: user._id
    });
    return res.send({ image });
}

const getUserImagesHandler = async (req, res) => {
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
    const images = await Image.find({ createdBy: user._id }).limit(limit).skip(offset);
    return res.send({ images });
}

const getImageHandler = async (req, res) => {
    const { uid } = req.params;
    const image = await Image.findOne({ uid });
    if (!image) {
        return res.status(404).send({ error: 'Not found' });
    }

    return res.send({ image });
};

const createPublicImageHandler = async (req, res) => {
    const { html, url, width, height } = req.body;
    let image;
    try {
        const { url: imageLink, metadata } = await captureImages({
            html,
            url,
            width,
            height,
            browser
        });
        image = {
            url: imageLink,
            ...metadata
        };
    }
    catch (err) {
        console.log(err);
        return res.status(500).send({ error: 'Something went wrong' });
    }

    if (!image) {
        return res.status(500).send({ error: 'Something went wrong' });
    }

    image = await Image.create({
        url: image.url,
        html,
        width: image.width,
        height: image.height,
        createdBy: 'public'
    });
    return res.send({ image });
}

module.exports = async (fastify) => {
    fastify.register(async (fastify) => {
        fastify.register(verifyApiToken);
        fastify.post('/', createImageHandler);
        fastify.get('/', getUserImagesHandler);
    });

    fastify.register(async (fastify) => {
        fastify.get('/:uid', getImageHandler);
    });

    fastify.register(async (fastify) => {
        fastify.register(rateLimit, {
            max: 10,
            timeWindow: '1 minute',
            cache: 10000,
        });

        fastify.post('/public', createPublicImageHandler);
        fastify.get('/public', (req, res) => {
            res.send({ message: 'Hello from public' });
        });
        fastify.get('/public/:uid', getImageHandler);
    });
}

module.exports.autoPrefix = '/api/image';
