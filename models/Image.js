const mongoose = require('mongoose');
const uid = require('../util/uid');

const imageSchema = new mongoose.Schema({
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
        required: true
    },
    html: {
        type: String,
        required: true
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

//before saving the image, create uid
imageSchema.pre('save', async function (next) {
    const image = this;
    image.uid = await uid();
    next();
}
);

imageSchema.pre('get', function (next) {
    this.where({ active: true });
    next();
});

const Image = mongoose.model('Image', imageSchema);

module.exports = Image;