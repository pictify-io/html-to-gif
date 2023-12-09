const mongoose = require('mongoose');
const uid = require('../util/uid');

const gifSchema = new mongoose.Schema({
    uid: {
        type: String,
        unique: true
    },
    active: {
        type: Boolean,
        default: true
    },
    url: {
        type: String,
    },
    html: {
        type: String,
    },
    link: {
        type: String,
    },
    width: {
        type: Number,
    },
    height: {
        type: Number,
    },
    framesPerSecond: {
        type: Number,
    },
    animationLength: {
        type: Number,
    },
    createdBy: {
        type: String,
        required: true,
        ref: 'User'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

//before saving the gif, create uid
gifSchema.pre('save', async function (next) {
    const gif = this;
    gif.uid = await uid();
    next();
});

gifSchema.pre('get', function (next) {
    this.where({ active: true });
    next();
});

const Gif = mongoose.model('Gif', gifSchema);

module.exports = Gif;
