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


const filterActive = function (next) {
    this.where({ active: true });
    next();
};

apiTokenSchema.pre('save', async function (next) {
    const apiToken = this;
    if (!apiToken.uid) {
        apiToken.uid = await uid();
    }
    if (!apiToken.token) {
        apiToken.token = await token();
    }
    next();
});

apiTokenSchema.pre('findOne', filterActive);
apiTokenSchema.pre('find', filterActive);
apiTokenSchema.pre('findById', filterActive);
apiTokenSchema.pre('findByIdAndUpdate', filterActive);
apiTokenSchema.pre('findByIdAndRemove', filterActive);
apiTokenSchema.pre('findOneAndUpdate', filterActive);



const ApiToken = mongoose.model('ApiToken', apiTokenSchema);

module.exports = ApiToken;

