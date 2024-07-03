const mongoose = require('mongoose');
const uid = require('../util/uid');

const blogSchema = new mongoose.Schema({
  uid: {
    type: String,
    unique: true
  },
  title: {
    type: String,
    required: true
  },
  heroImage: {
    type: String
  },
  createdBy: {
    type: String,
  },
  active: {
    type: Boolean,
    default: true
  },
  tags: {
    type: Array,
    default: []
  },
  slug: {
    type: String,
    unique: true
  },
  status: {
    type: String,
    enum: ['draft', 'published'],
    default: 'draft'
  },
  type: {
    type: String,
    enum: ['guide', 'article'],
    default: 'article'
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  readingTime: {
    type: Number,
    default: 1
  },
  content: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const filterActive = function (next) {
  this.where({ active: true });
  next();
};



blogSchema.pre('save', async function (next) {
  const blog = this;
  if (!blog.uid) {
    blog.uid = await uid();
  }

  next();
});


blogSchema.pre('findOne', filterActive);
blogSchema.pre('find', filterActive);
blogSchema.pre('findById', filterActive);
blogSchema.pre('findByIdAndUpdate', filterActive);
blogSchema.pre('findByIdAndRemove', filterActive);
blogSchema.pre('findOneAndUpdate', filterActive);

const Blog = mongoose.model('Blog', blogSchema, 'blogs');

module.exports = Blog;


