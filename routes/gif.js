const createGif = require('../lib/gif')
const decorateUser = require('../plugins/decorate_user')
const verifyApiToken = require('../plugins/verify_api_token')
const { acquirePage, releasePage } = require('../service/browserpool')

const Gif = require('../models/Gif')
const Template = require('../models/Template')

const rateLimit = require('@fastify/rate-limit')
const { createGifFromEvents } = require('../lib/gif')
const { NoFramesCapturedError } = require('../lib/gif')

const createGifHandler = async (req, res) => {
  const startTime = Date.now()
  const { user } = req
  let browser

  const {
    url,
    width,
    height,
    template: templateUid,
    framesPerSecond,
    selector,
  } = req.body

  let { html } = req.body

  let gif
  let page
  if (templateUid) {
    const template = await Template.findOne({
      uid: templateUid,
      createdBy: user._id,
    })
    if (!template) {
      return res.status(403).send({ error: 'Template not found' })
    }
    html = await template.populateTemplate(variables)
  }

  try {
    page = await acquirePage()
    const { url: gifLink, metadata } = await createGif({
      html,
      url,
      width,
      height,
      framesPerSecond,
      selector,
      page,
    })
    gif = {
      url: gifLink,
      ...metadata,
    }
  } catch (err) {
    console.error('Error in GIF creation:', err)
    console.error(`Generation failed after ${Date.now() - startTime}ms`)
    return res.status(500).send({ error: 'GIF generation failed', details: err.message })
  } finally {
    if (page) {
      await releasePage(page)
      page = null
    }
  }

  if (!gif) {
    return res.status(500).send({ error: 'Something went wrong' })
  }

  gif = await Gif.create({
    url: gif.url,
    html,
    width: gif.width,
    height: gif.height,
    framesPerSecond: gif.framesPerSecond,
    animationLength: gif.animationLength,
    createdBy: user._id,
  })
  user.usage.count += 1
  await user.save()

  const processingTime = Date.now() - startTime
  console.log(`GIF created successfully in ${processingTime}ms`)

  return res.send({ gif, _meta: { processingTime } })
}

const getUserGifsHandler = async (req, res) => {
  const { user } = req
  let { limit, offset } = req.query
  if (!limit) {
    limit = 30
  }
  if (!offset) {
    offset = 0
  }
  if (limit > 100) {
    limit = 100
  }
  if (offset < 0) {
    offset = 0
  }
  const gifs = await Gif.find({ createdBy: user._id }).limit(limit).skip(offset)
  return res.send({ gifs })
}

const getGifHandler = async (req, res) => {
  const { uid } = req.params
  const gif = await Gif.findOne({ uid })
  if (!gif) {
    return res.status(404).send({ error: 'Not found' })
  }
  return res.send({ gif })
}

const createPublicGifHandler = async (req, res) => {
  const { html, url, width, height, framesPerSecond } = req.body
  let gif
  let page
  try {
    page = await acquirePage()
    const { url: gifLink, metadata } = await createGif({
      html,
      url,
      width,
      height,
      framesPerSecond,
      page,
    })
    gif = {
      url: gifLink,
      ...metadata,
    }
  } catch (err) {
    console.error('Error in public GIF creation:', err)
    return res.status(500).send({ error: 'GIF generation failed', details: err.message })
  } finally {
    if (page) {
      await releasePage(page)
      page = null
    }
  }

  if (!gif) {
    return res.status(500).send({ error: 'Something went wrong' })
  }

  gif = await Gif.create({
    url: gif.url,
    uid: gif.uid,
    html,
    width: gif.width,
    height: gif.height,
    framesPerSecond: gif.framesPerSecond,
    animationLength: gif.animationLength,
    createdBy: 'public',
  })

  return res.send({ gif })
}

const createEnterpriseGifHandler = async (req, res) => {
  const startTime = Date.now()
  const { user } = req
  if (user.id !== process.env.STORYLANE_USER_ID) {
    return res.status(403).send({ error: 'Forbidden' })
  }
  const {
    url,
    width,
    height,
    framesPerSecond,
    selector,
    frameDurationSeconds,
  } = req.body

  if (!url) {
    return res.status(400).send({ error: 'URL is required' })
  }

  let parsedFrameDuration = Number(frameDurationSeconds)
  if (Number.isNaN(parsedFrameDuration) || parsedFrameDuration <= 0) {
    parsedFrameDuration = undefined
  }

  let page
  try {
    page = await acquirePage()
    const { url: gifUrl, metadata } = await createGifFromEvents({
      url,
      width,
      height,
      framesPerSecond,
      frameDurationSeconds: parsedFrameDuration,
      selector,
      page,
      onCaptureComplete: async () => {
        if (page) {
          await releasePage(page)
          page = null
        }
      },
    })

    const gif = await Gif.create({
      url: gifUrl,
      width: metadata.width,
      height: metadata.height,
      framesPerSecond: metadata.framesPerSecond,
      animationLength: metadata.animationLength,
      createdBy: user._id,
      timeCompressionFactor: metadata.timeCompressionFactor,
      frameDurationSeconds: metadata.frameDurationSeconds,
    })

    user.usage.count += 1.5
    await user.save()

    const processingTime = Date.now() - startTime
    console.log(`Enterprise GIF created in ${processingTime}ms - ${metadata.frameCount} frames`)

    return res.send({
      gif,
      metadata,
      _meta: { processingTime }
    })
  } catch (err) {
    console.error('Error in enterprise GIF creation:', err)
    console.error(`Generation failed after ${Date.now() - startTime}ms`)
    if (err instanceof NoFramesCapturedError) {
      return res.status(422).send({ error: 'No frames captured' })
    }
    if (page) {
      await releasePage(page)
      page = null
    }
    return res.status(500).send({ error: 'Failed to created GIF' })
  } finally {
    if (page) {
      await releasePage(page)
      page = null
    }
  }
}

// Health check handler
const healthCheckHandler = async (req, res) => {
  const { getPoolStats } = require('../service/browserpool')
  try {
    const poolStats = await getPoolStats()
    const memUsage = process.memoryUsage()

    return res.send({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      browserPool: poolStats.browserPool,
      pagePool: poolStats.pagePool,
      memory: {
        rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)}MB`,
        heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
        heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
        external: `${(memUsage.external / 1024 / 1024).toFixed(2)}MB`,
      }
    })
  } catch (err) {
    console.error('Health check error:', err)
    return res.status(500).send({ status: 'unhealthy', error: err.message })
  }
}

module.exports = async (fastify) => {
  fastify.register(async (fastify) => {
    fastify.register(verifyApiToken)
    fastify.post('/', createGifHandler)
    fastify.post('/storylane', createEnterpriseGifHandler)
  })

  fastify.register(async (fastify) => {
    fastify.register(decorateUser)
    fastify.get('/', getUserGifsHandler)
  })

  fastify.register(async (fastify) => {
    fastify.get('/:uid', getGifHandler)
  })

  // Health check endpoint (no auth required)
  fastify.register(async (fastify) => {
    fastify.get('/health', healthCheckHandler)
  })

  fastify.register(async (fastify) => {
    await fastify.register(rateLimit, {
      max: 5,
      timeWindow: '1 minute',
      cache: 10000,
      allowList: [process.env.FRONTEND_IP],
    })

    fastify.post('/public', createPublicGifHandler)
    fastify.get('/public', (req, res) => {
      res.send({ message: 'Hello from public' })
    })
  })
}

module.exports.autoPrefix = '/gif'
