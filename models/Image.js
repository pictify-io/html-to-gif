const mongoose = require('mongoose')
const uid = require('../util/uid')

const imageSchema = new mongoose.Schema({
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

//before saving the image, create uid
imageSchema.pre('save', async function (next) {
  const image = this
  if (!image.uid) {
    image.uid = await uid()
  }
  next()
})

imageSchema.pre('findOne', filterActive)
imageSchema.pre('find', filterActive)
imageSchema.pre('findById', filterActive)
imageSchema.pre('findByIdAndUpdate', filterActive)
imageSchema.pre('findByIdAndRemove', filterActive)
imageSchema.pre('findOneAndUpdate', filterActive)

const Image = mongoose.model('Image', imageSchema)

module.exports = Image
