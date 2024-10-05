const verifyRapidApiKey = require('../plugins/verify_rapidapi')
const { acquireBrowser, releaseBrowser } = require('../service/browserpool')
const captureImages = require('../lib/image')
const Image = require('../models/Image')

const createImageWithRapidApiHandler = async (req, res) => {
  const {
    url,
    width,
    height,
    selector,
    fileExtension,
    html
  } = req.body


  let image
  let browser
  try {
    browser = await acquireBrowser()
    const { url: imageLink, metadata } = await captureImages({
      html,
      url,
      width,
      height,
      selector,
      browser,
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
    if (browser) {
      await releaseBrowser(browser)
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
    createdBy: 'rapidapi',
  })

  return res.send({
    url: image.url,
    id: image.uid,
    createdAt: image.createdAt,
  })


}


const healthCheckHandler = async (req, res) => {
  return res.send({
    message: 'OK',
  })
}

module.exports = async (fastify) => {
  fastify.register(verifyRapidApiKey)
  fastify.post('/image', createImageWithRapidApiHandler)
  fastify.get('/health', healthCheckHandler)
}

module.exports.autoPrefix = '/rapidapi'