const mongoose = require('mongoose');
const { hash } = require('../util/hash');
const uid = require('../util/uid');
const AuthToken = require('./AuthToken');
const ApiToken = require('./ApiToken');
const ShortToken = require('./ShortToken');
const { sendEmail } = require('../service/sendgrid');

const { getRequestLimit, convertPlanToSlug } = require('../util/plan');


const userSchema = new mongoose.Schema({
    uid: {
        type: String,
        unique: true,
    },
    active: {
        type: Boolean,
        default: true
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
        default: 'free',
        required: true
    },
    lemonSqueezyCustomerId: {
        type: Number,
        default: null
    },
    usage: {
        count: {
            type: Number,
            default: 0
        },
        proratedUsage: {
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
userSchema.pre('save', async function (next) {
    const user = this;
    user.isCreated = this.$isNew;
    user.uid = await uid();
    if (user.password) {
        user.password = hash(user.password);
    }
    next();
});

userSchema.post('save', async function (user, next) {
    console.log('user created', user.isCreated);
    if (user.isCreated) {
        await ApiToken.create({ user: user._id });
        user.sendSignUpEmail();
    }
    next();
});

userSchema.methods.logOut = async function () {
    const user = this;
    await AuthToken.updateMany({ user: user._id, active: true }, { active: false });
};

userSchema.methods.hasExceededMonthlyLimit = function () {
    const user = this;

    // Check if a month has passed since the last reset
    if (Date.now() - user.usage.lastReset >= 30 * 24 * 60 * 60 * 1000) {
        // Reset the count and lastReset fields
        user.usage.count = 0;
        user.usage.lastReset = Date.now();
        user.usage.proratedUsage = 0;
        user.save();
    }

    // Check if the user has exceeded their monthly limit
    const plan = convertPlanToSlug(user.currentPlan);
    const monthlyLimit = getRequestLimit(plan);
    const proratedUsage = user.usage.proratedUsage || 0;
    return user.usage.count >= monthlyLimit + proratedUsage;
};

userSchema.methods.getPlanDetails = function () {
    const user = this;
    const plan = convertPlanToSlug(user.currentPlan);
    console.log('plan', plan);
    const monthlyLimit = getRequestLimit(plan);
    console.log('monthlyLimit', monthlyLimit);
    const hasExceededMonthlyLimit = user.hasExceededMonthlyLimit();
    const usage = user.usage.count;
    const nextReset = user.usage.lastReset + 30 * 24 * 60 * 60 * 1000;
    return { monthlyLimit, hasExceededMonthlyLimit, usage, nextReset };
}

userSchema.methods.sendSignUpEmail = async function () {
    const user = this;
    const data = {
        subject: 'Getting started with Pictify',
        templatePath: 'templates/user/welcome.ejs',
        data: {
            userName: user.email.split('@')[0]
        }
    };
    await sendEmail({ to: user.email, ...data });
}

userSchema.methods.sendResetPasswordEmail = async function () {
    const user = this;
    const token = await ShortToken.create({ user: user._id });
    const data = {
        subject: 'Reset your password',
        templatePath: 'templates/user/reset-password.ejs',
        data: {
            userName: user.email.split('@')[0],
            resetPasswordLink: `http://${process.env.FRONTEND_HOST}/reset-password?token=${token.key}`
        }
    };
    await sendEmail({ to: user.email, ...data });
}

userSchema.methods.calculateProration = function (newPlan) {
    const user = this;
    const plan = convertPlanToSlug(user.currentPlan);
    if (plan === newPlan || plan === 'starter') {
        return 0;
    }
    const currentMonthlyLimit = getRequestLimit(plan);
    const proratedUsage = Math.max(currentMonthlyLimit - user.usage.count, 0);
    return proratedUsage;
}

const User = mongoose.model('User', userSchema);

module.exports = User;