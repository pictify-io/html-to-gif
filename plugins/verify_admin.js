const fp = require('fastify-plugin');

const verifyAdmin = async (request, reply) => {
  const { user } = request;
  if (!user) {
    reply.code(401).send({ message: 'Unauthorized' });
  }

  if (user.email !== process.env.ADMIN_EMAIL_ID) {
    reply.code(401).send({ message: 'Unauthorized' });
  }
}

module.exports = fp(async (fastify, opts) => {
  fastify.addHook('preHandler', verifyAdmin);
});