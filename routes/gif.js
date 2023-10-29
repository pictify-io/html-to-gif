const createGif = require('../lib/gif');
const decorateUser = require('../plugins/decorate_user');
const Gif = require('../models/Gif');
const rateLimit = require('@fastify/rate-limit');

    const createGifHandler = async (req, res) => {
        const { user } = req;
        const { html, url, width, height, framesPerSecond } = req.body;
        let gif;
        try {
            const { url: gifLink, metadata } = await createGif({
                html,
                url,
                width,
                height,
                framesPerSecond
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
    const gifs = await Gif.find({ createdBy: user._id });
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
            framesPerSecond
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
        fastify.register(decorateUser);
        fastify.post('/create', createGifHandler);
        fastify.get('/user', getUserGifsHandler);
    })

    fastify.register(async (fastify) => {
        fastify.get('/:uid', getGifHandler);
    });

    fastify.register(async (fastify) => {
        fastify.register(rateLimit, {
            max: 10,
            timeWindow: '1 minute',
            cache: 10000,
        });

        fastify.post('/public', createPublicGifHandler);
        fastify.get('/public', (req, res) => {
            res.send({ message: 'Hello from public' });
        });
    });
};

module.exports.autoPrefix = '/api/gif';

