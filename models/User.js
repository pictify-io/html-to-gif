const mongoose = require('mongoose');
const uid = require('../util/uid');

const userSchema = new mongoose.Schema({
    uid: {
        type: String,
        required: true,
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
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    currentPlan: {
        type: String,
        default: 'demo',
        enum: ['demo', 'free', 'basic', 'premium'],
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

//before saving the user, hash the password and create uid
userSchema.pre('save', function (next) {
    const user = this;
    if (!user.isModified('password')) return next();
    user.uid = uid();
    next();
});

// Fetch only active users
userSchema.pre('get', function (next) {
    this.where({ active: true });
    next();
});

const User = mongoose.model('User', userSchema);

module.exports = User;