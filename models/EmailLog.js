const mongoose = require('mongoose');

const emailLogSchema = new mongoose.Schema({
  user: {
    type: String,
    required: true,
    ref: 'User'
  },
  type: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const EmailLog = mongoose.model('EmailLog', emailLogSchema);

module.exports = EmailLog;