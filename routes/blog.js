const Blog = require('../models/Blog');

const getAllBlogs = async (req, res) => {
  let { limit = 10, offset = 0, type } = req.query;

  limit = parseInt(limit);
  offset = parseInt(offset);

  if (!['guide', 'article'].includes(type)) {
    return res.status(400).send({ message: 'Invalid type' });
  }

  const blogs = await Blog.find({ status: 'published', type }).limit(limit).skip(offset);
  return res.send({ blogs });
}

const getFeaturedBlog = async (req, res) => {
  const blog = await Blog.findOne({ status: 'published', isFeatured: true });
  if (!blog) {
    return res.status(404).send({ message: 'Featured blog not found' });
  }
  return res.send({ blog });
}

const getBlog = async (req, res) => {
  const { slug } = req.params;
  const blog = await Blog.findOne({ slug, status: 'published' });
  if (!blog) {
    return res.status(404).send({ message: 'Blog not found' });
  }
  return res.send({ blog });
}

const getRecommendedBlog = async (req, res) => {
  const { limit = 3 } = req.query;
  const { slug } = req.params;
  const blog = await Blog.findOne({ slug, status: 'published' });
  if (!blog) {
    return res.status(404).send({ message: 'Blog not found' });
  }
  const recommendedBlogs = await Blog.aggregate([
    { $match: { status: 'published', type: blog.type, slug: { $ne: blog.slug } } },
    { $sample: { size: parseInt(limit) } }
  ]);

  return res.send({ recommendedBlogs });
};

module.exports = async (fastify) => {
  fastify.get('/featured', getFeaturedBlog);
  fastify.get('/', getAllBlogs);
  fastify.get('/:slug', getBlog);
  fastify.get('/:slug/recommended', getRecommendedBlog);
}

module.exports.autoPrefix = '/blogs';