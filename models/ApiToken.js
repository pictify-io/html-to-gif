const mongoose = require('mongoose');
const uid = require('../util/uid');
const token = require('../util/token');

const apiTokenSchema = new mongoose.Schema({
    uid: {
        type: String,
        unique: true
    },
    token: {
        type: String,
        unique: true
    },
    active: {
        type: Boolean,
        default: true
    },
    user: {
        type: String,
        required: true,
        ref: 'User'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});




apiTokenSchema.pre('save', async function (next) {
    const apiToken = this;
    apiToken.uid = await uid();
    apiToken.token = await token();
    next();
});

apiTokenSchema.pre('get', function (next) {
    this.where({ active: true });
    next();
});

const ApiToken = mongoose.model('ApiToken', apiTokenSchema);

module.exports = ApiToken;

