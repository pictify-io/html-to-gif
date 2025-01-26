const { acquirePage, releasePage } = require('../service/browserpool')
const captureImages = require('../lib/image')
const verifyApiToken = require('../plugins/verify_api_token')
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
  const allowedOrigins = ['https://pictify.io', 'https://www.pictify.io'];
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


module.exports = async (fastify) => {
  fastify.register(async (fastify) => {
    fastify.register(verifyApiToken)
    fastify.post('/', createImageHandler)
    fastify.post('/og-image', ogImageHandler)
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
