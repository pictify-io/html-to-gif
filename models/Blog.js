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
  status: {
    type: String,
    enum: ['draft', 'published'],
    default: 'draft'
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

const createSlug = async function (next) {
  const blog = this;
  if (!blog.slug) {
    blog.slug = blog.title.toLowerCase().replace(/ /g, '-');
  }
  next();
}

blogSchema.pre('save', async function (next) {
  const blog = this;
  if (!blog.uid) {
    blog.uid = await uid();
  }

  next();
});


blogSchema.pre('findOne', filterActive, createSlug);
blogSchema.pre('find', filterActive), createSlug;
blogSchema.pre('findById', filterActive, createSlug);
blogSchema.pre('findByIdAndUpdate', filterActive, createSlug);
blogSchema.pre('findByIdAndRemove', filterActive, createSlug);
blogSchema.pre('findOneAndUpdate', filterActive, createSlug);

const Blog = mongoose.model('Blog', blogSchema);

module.exports = Blog;


