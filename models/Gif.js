const mongoose = require('mongoose');
const uid = require('../util/uid');

const gifSchema = new mongoose.Schema({
    uid: {
        type: String,
        required: true,
        unique: true
    },
    active: {
        type: Boolean,
        default: true
    },
    url: {
        type: String,
        required: true
    },
    html: {
        type: String,
        required: true
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
gifSchema.pre('save', function (next) {
    const gif = this;
    gif.uid = uid();
    next();
});

gifSchema.pre('get', function (next) {
    this.where({ active: true });
    next();
});

const Gif = mongoose.model('Gif', gifSchema);

module.exports = Gif;
