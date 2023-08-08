const createGif = require('../lib/index');
const decorateUser = require('../plugins/decorate_user');
const Gift = require('../models/Gif');

module.exports = async (fastify) => {

    const createGifHandler = async (req, res) => {
        const { user } = req;
        const { html, url } = req.body;
        const gif = await createGif({
            html,
            url
        });

        await Gif.create({
            html,
            url,
            createdBy: user._id
        });

        return res.send({ gif });
    }

    fastify.register(decorateUser);
    fastify.post('/create', createGifHandler);
};

module.exports.autoPrefix = '/api/gif';

