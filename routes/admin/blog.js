const Blog = require('../../models/Blog');
const decorateUser = require('../../plugins/decorate_user');
const verifyAdmin = require('../../plugins/verify_admin');

const createBlogHandler = async (req, res) => {
  const { user } = req;
  const { title, content } = req.body;
  const blog = await Blog.create({ title, content, createdBy: user._id });
  return res.send({ blog });
};

const publishBlogHandler = async (req, res) => {
  const { user } = req;
  const { blogUid } = req.params;
  const blog = await Blog.findOne({ uid: blogUid, createdBy: user._id });
  if (!blog) {
    return res.status(404).send({ message: 'Blog not found' });
  }
  await blog.updateOne({ status: 'published' });
  return res.send({ blog });
}

const getBlogHandler = async (req, res) => {
  const { blogUid } = req.params;
  const blog = await Blog.findOne({ uid: blogUid });
  if (!blog) {
    return res.status(404).send({ message: 'Blog not found' });
  }
  return res.send({ blog });
}

const getBlogsHandler = async (req, res) => {
  let { limit, offset } = req.query;
  if (!limit) {
    limit = 30;
  }
  if (!offset) {
    offset = 0;
  }
  if (limit > 100) {
    limit = 100;
  }
  if (offset < 0) {
    offset = 0;
  }
  const blogs = await Blog.find().limit(limit).skip(offset);
  return res.send({ blogs });
}

module.exports = async (fastify) => {
  fastify.register(decorateUser);
  fastify.register(verifyAdmin);
  fastify.post('/', createBlogHandler);
  fastify.post('/:blogUid/publish', publishBlogHandler);
  fastify.get('/:blogUid', getBlogHandler);
  fastify.get('/', getBlogsHandler);
}

module.exports.autoPrefix = '/admin/blogs';