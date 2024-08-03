const mongoose = require('mongoose')
const uid = require('../util/uid')

const authTokenSchema = new mongoose.Schema({
  uid: {
    type: String,
    unique: true,
  },
  active: {
    type: Boolean,
    default: true,
  },
  user: {
    type: String,
    required: true,
    ref: 'User',
  },
  validTill: {
    type: Date,
    default: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
})

const filterActive = function (next) {
  this.where({ active: true })
  next()
}

authTokenSchema.pre('save', async function (next) {
  const authToken = this
  if (!authToken.uid) {
    authToken.uid = await uid()
  }

  next()
})

authTokenSchema.pre('findOne', filterActive)
authTokenSchema.pre('find', filterActive)
authTokenSchema.pre('findById', filterActive)
authTokenSchema.pre('findByIdAndUpdate', filterActive)
authTokenSchema.pre('findByIdAndRemove', filterActive)
authTokenSchema.pre('findOneAndUpdate', filterActive)

authTokenSchema.methods.isValid = async function () {
  const authToken = this
  if (!authToken.active) return false
  if (!authToken.user) return false
  if (authToken.validTill < Date.now()) return false
  return true
}

authTokenSchema.methods.refresh = async function () {
  const authToken = this
  if (authToken.validTill - Date.now() > 1000 * 60 * 60 * 24 * 3)
    return authToken
  authToken.validTill = Date.now() + 1000 * 60 * 60 * 24 * 7 // 7 days
  await authToken.save()
  return authToken
}

const AuthToken = mongoose.model('AuthToken', authTokenSchema)

module.exports = AuthToken
