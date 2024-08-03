const decorateUser = require('../plugins/decorate_user')
const Image = require('../models/Image')
const Gif = require('../models/Gif')
const { deleteFile } = require('../service/aws')

const deleteMediaHandler = async (req, res) => {
  const { user } = req
  const { mediUid } = req.params
  let media
  let extension
  const image = await Image.findOne({ uid: mediUid, createdBy: user._id })
  if (image) {
    media = image
    extension = '.png'
  }

  const gif = await Gif.findOne({ uid: mediUid, createdBy: user._id })

  if (gif) {
    media = gif
    extension = '.gif'
  }

  if (!media) {
    return res.status(404).send({ message: 'Media not found' })
  }

  const key = `${media.uid}${extension}`
  try {
    await deleteFile(key)
  } catch (err) {
    console.log(err)
    return res.status(500).send({ message: 'Something went wrong' })
  }
  await media.updateOne({ active: false })
  return res.send({ message: 'Media deleted successfully' })
}

module.exports = async (fastify) => {
  fastify.register(async (fastify) => {
    fastify.register(decorateUser)
    fastify.delete('/:mediUid', deleteMediaHandler)
  })
}
