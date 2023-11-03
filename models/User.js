const mongoose = require('mongoose');
const { hash } = require('../util/hash');
const uid = require('../util/uid');
const AuthToken = require('./AuthToken');

const getMonthlyLimit = (plan) => {
    switch (plan) {
        case 'free':
            return 1000;
        case 'basic':
            return 10000;
        case 'premium':
            return 100000;
        default:
            return 0;
    }
};

const userSchema = new mongoose.Schema({
    uid: {
        type: String,
        unique: true,
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
    isEmailVerified: {
        type: Boolean,
        default: false
    },
    signupMethod: {
        type: String,
        enum: ['email', 'google', 'facebook'],
        default: 'email',
        required: true
    },
    password: {
        type: String,
    },
    currentPlan: {
        type: String,
        default: 'demo',
        enum: ['demo', 'free', 'basic', 'premium'],
        required: true
    },
    usage: {
        count: {
            type: Number,
            default: 0
        },
        lastReset: {
            type: Date,
            default: Date.now
        }
    },

    createdAt: {
        type: Date,
        default: Date.now
    }
});

//before saving the user, hash the password and create uid
userSchema.pre('create', async function (next) {
    const user = this;
    user.uid = await uid();
    console.log(user);
    user.password = hash(user.password);
    next();
});

userSchema.methods.logOut = async function () {
    const user = this;
    await AuthToken.update({ user: user.uid }, { active: false });
};

userSchema.methods.hasExceededMonthlyLimit = function () {
    const user = this;

    // Check if a month has passed since the last reset
    if (Date.now() - user.usage.lastReset >= 30 * 24 * 60 * 60 * 1000) {
        // Reset the count and lastReset fields
        user.usage.count = 0;
        user.usage.lastReset = Date.now();
    }

    // Check if the user has exceeded their monthly limit
    const monthlyLimit = getMonthlyLimit(user.currentPlan);
    return user.usage.count >= monthlyLimit;
};

const User = mongoose.model('User', userSchema);

module.exports = User;