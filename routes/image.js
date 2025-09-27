const { acquirePage, releasePage } = require('../service/browserpool')
const captureImages = require('../lib/image')
const { takeScreenshot, takeScreenshotStream } = require('../lib/agent-screenshot')
const verifyApiToken = require('../plugins/verify_api_token')
const verifyApiTokenFlexible = require('../plugins/verify_api_token_flexible')
const decorateUser = require('../plugins/decorate_user')
const getRenderedHTML = require('../lib/page-content')
const Image = require('../models/Image')
const Template = require('../models/Template')
const rateLimit = require('@fastify/rate-limit')

const createImageHandler = async (req, res) => {
  const { user } = req
  const {
    url,
    width,
    height,
    template: templateUid,
    variables,
    selector,
    fileExtension,
  } = req.body
  let { html } = req.body

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

  let image
  let page
  try {
    page = await acquirePage()
    const { url: imageLink, metadata } = await captureImages({
      html,
      url,
      width,
      height,
      selector,
      page,
      fileExtension,
    });
    image = {
      url: imageLink,
      ...metadata,
    };
  } catch (err) {
    console.error('Error in image capture:', err);
    return res.status(500).send({ error: 'Image generation failed', details: err.message });
  } finally {
    if (page) {
      await releasePage(page)
    }
  }

  if (!image) {
    return res.status(500).send({ error: 'Something went wrong' })
  }

  image = await Image.create({
    uid: image.uid,
    url: image.url,
    html,
    width: image.width,
    height: image.height,
    createdBy: user._id,
  })

  user.usage.count += 1
  await user.save()

  return res.send({
    url: image.url,
    id: image.uid,
    createdAt: image.createdAt,
  })
}

const ogImageHandler = async (req, res) => {
  const { user } = req
  const { template: templateUid, heading, description, logo } = req.body;
  const template = await Template.findOne({ uid: templateUid });
  if (!template) {
    return res.status(404).send({ error: 'Template not found' });
  }
  const html = await template.populateOgImage({ heading, description, logo });
  let page
  let image
  try {
    page = await acquirePage()
    const { url: imageLink, metadata } = await captureImages({ html, width: 1200, height: 630, selector: 'body', page });
    image = { url: imageLink, ...metadata };
  } catch (err) {
    console.error('Error in image capture:', err);
    return res.status(500).send({ error: 'Image generation failed', details: err.message });
  } finally {
    if (page) {
      await releasePage(page)
    }
  }

  if (!image) {
    return res.status(500).send({ error: 'Something went wrong' })
  }

  image = await Image.create({
    url: image.url,
    html,
    width: image.width,
    height: image.height,
    createdBy: user._id,
  })

  user.usage.count += 1
  await user.save()

  return res.send({
    url: image.url,
    id: image.uid,
    createdAt: image.createdAt,
  });
}

const getUserImagesHandler = async (req, res) => {
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
  let images = await Image.find({ createdBy: user._id })
    .limit(limit)
    .skip(offset)
  images = images.map((image) => {
    return {
      url: image.url,
      id: image.uid,
      createdAt: image.createdAt,
    }
  })
  return res.send({ images })
}

const getImageHandler = async (req, res) => {
  const { uid } = req.params
  const image = await Image.findOne({ uid })
  if (!image) {
    return res.status(404).send({ error: 'Not found' })
  }

  return res.send({ image })
}

const createPublicImageHandler = async (req, res) => {
  const { html, url, width, height, selector, fileExtension } = req.body;
  const allowedOrigins = ['https://pictify.io', 'https://www.pictify.io', 'http://localhost:5173'];
  const origin = req.headers['origin'];
  if (!allowedOrigins.includes(origin)) {
    return res.status(403).send({ error: 'Forbidden' });
  }
 let image
  let page
  try {
    page = await acquirePage()
    const { url: imageLink, metadata } = await captureImages({
      html,
      url,
      width,
      height,
      selector,
      page,
      fileExtension,
    })
    image = {
      url: imageLink,
      ...metadata,
    }
  } catch (err) {
    console.log(err)
    return res.status(500).send({ error: 'Something went wrong' })
  } finally {
    if (page) {
      await releasePage(page)
    }
  }

  if (!image) {
    return res.status(500).send({ error: 'Something went wrong' })
  }

  image = await Image.create({
    url: image.url,
    html,
    width: image.width,
    height: image.height,
    createdBy: 'public',
  })
  return res.send({ image })
}

const getPageContent = async (req, res) => {
  let { url } = req.query;
  if (!url) {
    return res.status(400).send({ message: 'URL is required' });
  }
  url = decodeURIComponent(url);
  let page
  let content
  try {
    page = await acquirePage()
    content = await getRenderedHTML(url, page);
  } catch (err) {
    console.log(err)
    return res.status(500).send({ error: 'Something went wrong' })
  } finally {
    if (page) {
      await releasePage(page)
    }
  }
  if (!content) {
    return res.status(500).send({ error: 'Something went wrong' })
  }
  return res.send({ content })
}

const healthCheckHandler = async (req, res) => {
  const { getPoolStats } = require('../service/browserpool')
  try {
    const page = await acquirePage();
    await releasePage(page);
    return res.send({
      status: 'ok',
      poolStats: await getPoolStats()
    });
  } catch (error) {
    console.error('Health check failed:', error);
    return res.status(503).send({ status: 'error', message: 'Browser/page pool unavailable' });
  }
};

const agentScreenshotHandler = async (req, res) => {
  const { user } = req
  const { prompt } = req.body

  if (!prompt) {
    return res.status(400).send({ error: 'Prompt is required' })
  }

  let result
  try {
    const startTime = Date.now()
    result = await takeScreenshot(prompt)
    const endTime = Date.now()

    if (!result.success) {
      return res.status(500).send({
        error: 'Screenshot generation failed',
        details: result.error
      })
    }

    // Extract screenshot data with proper fallbacks
    const screenshotData = result.screenshot || {}
    const screenshotMetadata = screenshotData.metadata || screenshotData || {}


    // Save the image to database
    const image = await Image.create({
      url: screenshotData.url || result.screenshot?.url,
      html: '', // No HTML for agent screenshots
      width: screenshotMetadata.width || screenshotData.width || 1280,
      height: screenshotMetadata.height || screenshotData.height || 720,
      createdBy: user._id,
    })

    // Update user usage
    user.usage.count += 1
    await user.save()

    return res.send({
      url: screenshotData.url || result.screenshot?.url,
      id: image.uid,
      createdAt: image.createdAt,
      metadata: {
        prompt,
        url: result.metadata?.url || 'unknown',
        elementDescription: result.metadata?.elementDescription,
        selector: result.metadata?.selector,
        executionTime: endTime - startTime
      }
    })
  } catch (error) {
    console.error('Error in agent screenshot:', error)
    return res.status(500).send({
      error: 'Agent screenshot failed',
      details: error.message
    })
  }
};

const agentScreenshotStreamHandler = async (req, reply) => {
  const { user } = req
  const { prompt } = req.body

  if (!prompt) {
    return reply.status(400).send({ error: 'Prompt is required' })
  }

  // Hijack the response to handle it manually
  reply.hijack()

  // Get the raw response object
  const res = reply.raw

  // Set up CORS headers first
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  // Write headers
  res.writeHead(200)

  // Send initial connection message
  res.write('data: {"type":"connected","data":{"message":"Connected to agent screenshot stream"}}\n\n')

  let savedImage = null
  let finalResult = null

  // SSE callback function
  const sseCallback = (event) => {
    try {
      const sseData = JSON.stringify(event)
      res.write(`data: ${sseData}\n\n`)

      // If this is the completion event, save the image
      if (event.type === 'complete' && event.data && event.data.result) {
        finalResult = event.data.result
      }
    } catch (error) {
      console.error('Error writing SSE data:', error)
    }
  }

  // Handle client disconnect
  req.raw.on('close', () => {
    console.log('Client disconnected from agent screenshot stream')
    res.end()
  })

  req.raw.on('error', (error) => {
    console.error('Request error in agent screenshot stream:', error)
    res.end()
  })

  try {
    // Start the streaming screenshot process
    const result = await takeScreenshotStream(prompt, sseCallback)

    if (result && result.success && result.screenshot) {
      // Extract screenshot data with proper fallbacks
      const screenshotData = result.screenshot || {}
      const screenshotMetadata = screenshotData.metadata || screenshotData || {}

      // Save the image to database
      savedImage = await Image.create({
        url: screenshotData.url || result.screenshot?.url,
        html: '', // No HTML for agent screenshots
        width: screenshotMetadata.width || screenshotData.width || 1280,
        height: screenshotMetadata.height || screenshotData.height || 720,
        createdBy: user._id,
      })

      // Update user usage
      user.usage.count += 1
      await user.save()

      // Send final success message with database info
      const finalMessage = {
        type: 'saved',
        data: {
          step: 'saved',
          message: 'Screenshot saved to database',
          url: screenshotData.url || result.screenshot?.url,
          id: savedImage.uid,
          createdAt: savedImage.createdAt,
          metadata: {
            prompt,
            url: result.metadata?.url || 'unknown',
            elementDescription: result.metadata?.elementDescription,
            selector: result.metadata?.selector,
            executionTime: result.metadata?.executionTime
          },
          timestamp: new Date().toISOString()
        }
      }

      res.write(`data: ${JSON.stringify(finalMessage)}\n\n`)
    }
  } catch (error) {
    console.error('Error in agent screenshot stream:', error)

    // Send error event
    const errorMessage = {
      type: 'error',
      data: {
        step: 'error',
        message: 'Screenshot stream failed',
        error: error.message,
        timestamp: new Date().toISOString()
      }
    }

    res.write(`data: ${JSON.stringify(errorMessage)}\n\n`)
  } finally {
    // Close the stream
    res.end()
  }
};


module.exports = async (fastify) => {
  fastify.register(async (fastify) => {
    fastify.register(verifyApiToken)
    fastify.post('/', createImageHandler)
    fastify.post('/og-image', ogImageHandler)
    fastify.post('/agent-screenshot', agentScreenshotHandler)
  })

  // Handle OPTIONS preflight for SSE endpoint (no auth required)
  fastify.register(async (fastify) => {
    fastify.options('/agent-screenshot-stream', async (request, reply) => {
      return reply
        .header('Access-Control-Allow-Origin', '*')
        .header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        .header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        .header('Access-Control-Max-Age', '86400')
        .code(204)
        .send()
    })
  })

  // SSE endpoint with authentication
  fastify.register(async (fastify) => {
    fastify.register(verifyApiTokenFlexible)
    fastify.post('/agent-screenshot-stream', agentScreenshotStreamHandler)
  })


  fastify.register(async (fastify) => {
    fastify.register(decorateUser)
    fastify.get('/', getUserImagesHandler)
  })

  fastify.register(async (fastify) => {
    fastify.get('/:uid', getImageHandler)
  })

  fastify.register(async (fastify) => {
    fastify.get('/health', healthCheckHandler)
  });

  fastify.register(async (fastify) => {
    fastify.register(rateLimit, {
      max: 10,
      timeWindow: '1 minute',
      cache: 10000,
    })
    fastify.get('/page-content', getPageContent)
    fastify.post('/public', createPublicImageHandler)
    fastify.get('/public', (req, res) => {
      res.send({ message: 'Hello from public' })
    })
    fastify.get('/public/:uid', getImageHandler)
  })
}

module.exports.autoPrefix = '/image'
