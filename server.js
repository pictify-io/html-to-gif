require('dotenv').config()

const oauth2Plugin = require('@fastify/oauth2')
const AutoLoad = require('fastify-autoload')
const path = require('path')
const cors = require('@fastify/cors')
const fastifyHttpProxy = require('@fastify/http-proxy')
const db = require('./db')
const { initializeBrowserPool, cleanup } = require('./service/browserpool')
const fs = require('fs')

const port = process.env.PORT || 3001

const fastify = require('fastify')({
  logger: false,
})

//Beautify logs
fastify.addHook('onRequest', (request, reply, done) => {
  console.log(`Request: ${request.method} ${request.url}`)
  done()
})

fastify.addHook('onResponse', (request, reply, done) => {
  console.log(`Response: ${request.method} ${request.url}`)
  done()
})

fastify.addHook('onError', (request, reply, error, done) => {
  console.log(`Error: ${request.method} ${request.url}`)
  console.log(error)
  done()
})

fastify.register(cors, {
  origin: (origin, cb) => {
    if (!origin) {
      cb(null, true)
    } else {
      cb(null, origin) // Allow the request's origin
    }
  },
  methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
})

fastify.register(oauth2Plugin, {
  name: 'googleOAuth2',
  scope: ['profile', 'email'],
  credentials: {
    client: {
      id: process.env.GOOGLE_CLIENT_ID,
      secret: process.env.GOOGLE_CLIENT_SECRET,
    },
    auth: oauth2Plugin.GOOGLE_CONFIGURATION,
  },
  startRedirectPath: '/login/google',
  callbackUri: `${process.env.BACKEND_HOST}/auth/google/callback`,
  callbackUriParams: {
    access_type: 'offline',
  },
  generateStateFunction: (request) => {
    return 'SUYASH'
  },
  checkStateFunction: (returnedState, callback) => {
    callback()
  },
})

fastify.register(AutoLoad, {
  dir: path.join(__dirname, 'plugins', 'common'),
})

fastify.register(AutoLoad, {
  dir: path.join(__dirname, 'routes'),
})

fastify.register(fastifyHttpProxy, {
  prefix: '/posthog',
  replyOptions: {
    rewriteRequestHeaders: (originalRequest, originalHeaders) => {
      return {
        ...originalHeaders,
        host: 'app.posthog.com',
        'x-forwarded-for': originalRequest.ip,
        'x-forwarded-proto': 'https',
      }
    },
  },
  upstream: 'https://app.posthog.com',
})

process.on('SIGINT', async () => {
  console.log('Received SIGINT. Cleaning up...');
  try {
    // Remove PID file
    fs.unlinkSync('server.pid');
  } catch (err) {
    // Ignore if file doesn't exist
  }

  try {
    // Cleanup browser pools
    await cleanup();
    console.log('Cleanup completed successfully');
  } catch (err) {
    console.error('Error during cleanup:', err);
  }

  process.exit(0);
});

// Add SIGTERM handler
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM. Cleaning up...');
  try {
    // Remove PID file
    fs.unlinkSync('server.pid');
  } catch (err) {
    // Ignore if file doesn't exist
  }

  try {
    // Cleanup browser pools
    await cleanup();
    console.log('Cleanup completed successfully');
  } catch (err) {
    console.error('Error during cleanup:', err);
  }

  process.exit(0);
});

const startServer = async () => {
  try {
    await db()
    console.log('Connected to database')

    await initializeBrowserPool()
    console.log('Page pool initialized')

    await fastify.listen({ port })
    // Write PID file after server starts
    fs.writeFileSync('server.pid', process.pid.toString())
    console.log(`Server listening on port ${port}`)
  } catch (err) {
    console.error('Error starting server:', err)
    process.exit(1)
  }
}

startServer()
