const fp = require('fastify-plugin')
const ApiToken = require('../models/ApiToken')

const verifyApiTokenFlexible = async (request, reply) => {
  let token = null
  
  // Try to get token from Authorization header first
  const authorization = request.headers['authorization']
  if (authorization) {
    token = authorization.split('Bearer ')[1]
  }
  
  // If no token in header, try query parameter
  if (!token) {
    token = request.query.token
  }

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
  fastify.addHook('preHandler', verifyApiTokenFlexible)
}) 