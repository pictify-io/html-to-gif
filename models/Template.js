const mongoose = require('mongoose');
const uid = require('../util/uid');

const templateSchema = new mongoose.Schema({
    uid: {
        type: String,
        unique: true
    },
    active: {
        type: Boolean,
        default: true
    },
    name: {
        type: String,
        required: true
    },
    html: {
        type: String,
        required: true
    },
    variables: {
        type: Array,
        required: true
    },
    createdBy: {
        type: String,
        ref: 'User',
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

//before saving the template, create uid
templateSchema.pre('save', function (next) {
    const template = this;
    template.uid = uid();
    next();
});

templateSchema.pre('get', function (next) {
    this.where({ active: true });
    next();
});


const Template = mongoose.model('Template', templateSchema);

module.exports = Template;
