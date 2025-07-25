const fp = require('fastify-plugin')
const ApiToken = require('../models/ApiToken')

const verifyApiToken = async (request, reply) => {
  const authorization = request.headers['authorization']

  if (!authorization) {
    return reply.code(401).send({ message: 'Invalid Request' })
  }

  const token = authorization.split('Bearer ')[1]

  if (!token) {
    return reply.code(401).send({ message: 'Invalid Request' })
  }

  const authToken = await ApiToken.findOne({ token }).populate('user')
  if (!authToken) {
    return reply.code(401).send({ message: 'Invalid Request' })
  }

  const { user } = authToken

  if (!user) {
    return reply.code(401).send({ message: 'Invalid Request' })
  }

  if (user.hasExceededMonthlyLimit()) {
    return reply.code(429).send({ message: 'You have exhausted your plan limit' })
  }

  request.user = user
}

module.exports = fp(async (fastify, opts) => {
  fastify.decorateRequest('user', null)
  fastify.addHook('preHandler', verifyApiToken)
})
