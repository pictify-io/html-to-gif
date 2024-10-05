const fp = require('fastify-plugin')

const verifyRapidApiKey = async (request, reply) => {
  const rapidApiKey = request.headers['x-rapidapi-key']
  const rapidApiHost = request.headers['x-rapidapi-host']

  if (!rapidApiKey || !rapidApiHost) {
    reply.code(401).send({ message: 'Invalid Request' })
  }

  if (!isValidRapidApiKey(rapidApiKey, rapidApiHost)) {
    reply.code(401).send({ message: 'Invalid RapidAPI key' })
  }

  const proxySecret = request.headers['x-rapidapi-proxy-secret']
  if (proxySecret !== process.env.RAPID_API_PROXY_SECRET) {
    reply.code(401).send({ message: 'Invalid RapidAPI proxy secret' })
  }
}

module.exports = fp(async (fastify, opts) => {
  fastify.addHook('preHandler', verifyRapidApiKey)
})

function isValidRapidApiKey(key, host) {
  const rapidApiKey = process.env.RAPID_API_KEY
  const rapidApiHost = process.env.RAPID_API_HOST

  return key === rapidApiKey && host === rapidApiHost

}
