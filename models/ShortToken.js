const mongoose = require('mongoose');
const token = require('../util/token');

const shortTokenSchema = new mongoose.Schema({
  key: {
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
    default: Date.now,
    expires: '15m'
  },
});


shortTokenSchema.pre('save', async function (next) {
  const shortToken = this;
  if (!shortToken.key) {
    shortToken.key = await token(32);
  }
  next();
});

const ShortToken = mongoose.model('ShortToken', shortTokenSchema);

module.exports = ShortToken;
