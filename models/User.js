const mongoose = require('mongoose');
const { hash } = require('../util/hash');
const uid = require('../util/uid');
const AuthToken = require('./AuthToken');

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

const User = mongoose.model('User', userSchema);

module.exports = User;