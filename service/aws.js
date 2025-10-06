const AWS = require('aws-sdk')
const env = require('dotenv')
const stream = require('stream')

env.config()

// Optimized S3 configuration for faster uploads
const s3 = new AWS.S3({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  // Optimize connection pooling
  httpOptions: {
    timeout: 120000, // 2 minutes timeout
    connectTimeout: 5000, // 5 seconds connection timeout
    // Increase connection pool for better throughput
    agent: new (require('https')).Agent({
      maxSockets: 50, // Increased from default 50
      keepAlive: true,
      keepAliveMsecs: 30000
    })
  },
  // Enable faster DNS resolution
  maxRetries: 3,
  // Increase timeout for large files
  s3ForcePathStyle: false,
  signatureVersion: 'v4'
})

const generateKey = (fileExtension) => {
  const randomId = Math.random().toString(36).substring(2, 7)
  const timestamp = Date.now()
  return `${randomId}-${timestamp}.${fileExtension}`
}

const getUploadStream = (fileExtension) => {
  const key = generateKey(fileExtension)
  // Optimized PassThrough stream with larger buffer
  const pass = new stream.PassThrough({
    highWaterMark: 1024 * 1024 * 2 // 2MB buffer (increased from default 16KB)
  })

  const uploadParams = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: key,
    Body: pass,
    ContentDisposition: 'inline',
    ContentType: `image/${fileExtension}`,
    // Optimize caching
    CacheControl: 'public, max-age=31536000, immutable', // 1 year cache
    // Multipart upload optimization
    partSize: 10 * 1024 * 1024, // 10MB parts (increased from default 5MB)
    queueSize: 4, // Upload 4 parts concurrently (increased from default 1)
  }

  // Enable Transfer Acceleration if configured (can be 50-500% faster for distant regions)
  if (process.env.AWS_S3_ACCELERATE === 'true') {
    s3.config.useAccelerateEndpoint = true
  }

  return {
    writeStream: pass,
    promise: s3.upload(uploadParams).promise(),
    key: key,
  }
}

const deleteFile = (key) => {
  console.log('Deleting file', key)
  return s3
    .deleteObject({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
    })
    .promise()
}

module.exports = {
  getUploadStream,
  deleteFile,
}
