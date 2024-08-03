const mongoose = require('mongoose')
const uid = require('../util/uid')

const gifSchema = new mongoose.Schema({
  uid: {
    type: String,
    unique: true,
  },
  active: {
    type: Boolean,
    default: true,
  },
  url: {
    type: String,
  },
  html: {
    type: String,
  },
  link: {
    type: String,
  },
  width: {
    type: Number,
  },
  height: {
    type: Number,
  },
  framesPerSecond: {
    type: Number,
  },
  animationLength: {
    type: Number,
  },
  createdBy: {
    type: String,
    required: true,
    ref: 'User',
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

//before saving the gif, create uid
gifSchema.pre('save', async function (next) {
  const gif = this
  if (!gif.uid) {
    gif.uid = await uid()
  }
  next()
})

gifSchema.pre('findOne', filterActive)
gifSchema.pre('find', filterActive)
gifSchema.pre('findById', filterActive)
gifSchema.pre('findByIdAndUpdate', filterActive)
gifSchema.pre('findByIdAndRemove', filterActive)
gifSchema.pre('findOneAndUpdate', filterActive)

const Gif = mongoose.model('Gif', gifSchema)

module.exports = Gif
