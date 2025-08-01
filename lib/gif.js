const fs = require('fs')
const { spawn } = require('child_process')
const puppeteer = require('puppeteer')
const sharp = require('sharp')
const { getUploadStream } = require('../service/aws')

// Create a browser pool

class WebAnimationRecorder {
  constructor(url, html, width, height, framesPerSecond, selector, page) {
    this.selector = selector || 'html' // Capture the entire HTML content
    // this.url = url;
    this.url = url || `file://${__dirname}/test-2.html` // Replace 'https://example.com' with your desired website URL
    this.framesPerSecond = framesPerSecond || 18 // Replace 30 with your desired frames per second
    this.animationIndex = 0
    this.outputPath = null
    this.html = html
    this.width = width
    this.height = height
    this.page = page
  }

  async setupBrowser() {

    if (!this.page) {
      throw new Error('Page instance required')
    }

    if (this.width && this.height) {
      await this.page.setViewport({
        width: this.width,
        height: this.height,
      })
    }

    this.client = await this.page.target().createCDPSession()

    await this.client.send('Animation.enable')
    this.cdp = this.createProxy(this.client) // Make calls like Animation.enable() instead of client.send('Animation.enable')
  }

  async gatherAnimations() {
    /** @typedef AnimationGroup
     * @prop {number} startTime
     * @prop {Array<Protocol.Animation.Animation>} list
     */

    /** @type Array<AnimationGroup> */
    this.animationGroups = []
    this.lastAnimationTime = null

    this.containerObject = null
    this.selectorPromise = new Promise(async (resolve) => {
      await this.page.waitForSelector(this.selector, {
        visible: true,
        timeout: 500,
      })

      const rootNode = await this.cdp.DOM.getDocument()
      const containerNode = await this.cdp.DOM.querySelector({
        nodeId: rootNode.root.nodeId,
        selector: this.selector,
      })
      this.containerObject = await this.cdp.DOM.resolveNode({
        nodeId: containerNode.nodeId,
      })
      resolve()
    })

    const animationStartedCallback = this.animationStarted.bind(this)
    this.client.on('Animation.animationStarted', animationStartedCallback)

    await Promise.all([
      this.cdp.Animation.enable(),
      this.cdp.Animation.setPlaybackRate({ playbackRate: 1 }),
    ])

    if (this.html) {
      await this.page.setContent(this.html, { waitUntil: 'load' })
    } else {
      await this.page.goto(this.url, { waitUntil: 'load' })
    }

    await new Promise((resolve) => {
      const waitInterval = setInterval(() => {
        if (
          this.lastAnimationTime !== null &&
          new Date().getTime() > this.lastAnimationTime + 2000
        ) {
          clearInterval(waitInterval)
          resolve()
        }
      }, 200)
    })

    this.client.removeListener(
      'Animation.animationStarted',
      animationStartedCallback
    )
  }

  async prepareRecording() {
    let currentTime = 0

    if (this.animationIndex > this.animationGroups.length - 1) {
      throw new Error(
        'Animation index provided is greater than total animations'
      )
    }

    // Figure out how long the animation lasts
    this.animationLength = this.animationGroups[
      this.animationIndex
    ].list.reduce(function (a, b) {
      return Math.max(a, b.source.delay + b.source.duration)
    }, 0) // Add 1 second to the end to ensure animation completes

    const area = await this.page.$(this.selector)
    const areaElement = await area.asElement()
    if (!areaElement) {
      throw new Error('Element not found')
    }

    this.animationIDList = this.animationGroups[this.animationIndex].list.map(
      (x) => x.id
    )

    this.interval = 1000 / this.framesPerSecond
    this.maxBounds = {
      width: 0,
      height: 0,
      x: Infinity,
      y: Infinity,
    }

    // Calculate max bounds of animation so recording captures the whole animation
    while (currentTime < this.animationLength) {
      await this.cdp.Animation.seekAnimations({
        animations: this.animationIDList,
        currentTime: currentTime,
      })

      const boundingBoxes = await this.page.evaluate((selector) => {
        const elements = Array.from(document.querySelectorAll(selector))
        return elements.map((element) => {
          const { x, y, width, height } = element.getBoundingClientRect()
          return { x, y, width, height }
        })
      }, this.selector)

      boundingBoxes.forEach((bbox) => {
        this.maxBounds.width =
          Math.round(Math.max(bbox.x + bbox.width, this.maxBounds.width)) || 800
        this.maxBounds.height =
          Math.round(Math.max(bbox.y + bbox.height, this.maxBounds.height)) ||
          800
        this.maxBounds.x = Math.round(Math.min(bbox.x, this.maxBounds.x))
        this.maxBounds.y = Math.round(Math.min(bbox.y, this.maxBounds.y))
      })

      currentTime = currentTime + this.interval
    }

    // Make height and width even for ffmpeg
    if (this.maxBounds.height % 2 !== 0) this.maxBounds.height++
    if (this.maxBounds.width % 2 !== 0) this.maxBounds.width++

    // Add a delay after the animation to ensure it completes
    await new Promise((resolve) => setTimeout(resolve, 1000))

    const { writeStream, promise, key } = getUploadStream('gif')

    this.ffmpeg = spawn('ffmpeg', [
      '-y', // Overwrite output file
      '-r',
      this.framesPerSecond,
      '-f',
      'image2pipe',
      '-i',
      '-',
      '-f',
      'gif',
      '-loop',
      '0',
      '-vf',
      'split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer',
      '-',
    ])

    this.ffmpeg.stdout.pipe(writeStream)

    this.outputPath = `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${key}`

    console.log(
      's3 url',
      `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${key}`
    )

    this.ffmpeg.on('close', (code) => {
      if (code !== 0) {
        console.error(
          'ffmpeg encountered an error. Check ffmpeg.log for more details'
        )
      }
    })

    return { uploadPromise: promise }
  }

  async record() {
    try {
      let currentTime = 0
      const batchInterval = Math.floor(1000 / this.framesPerSecond)
      let batchStartTime = 0
      const framePromises = []

      // Capture one extra frame to ensure a smooth loop
      while (currentTime <= this.animationLength) {
        if (currentTime >= batchStartTime) {
          await this.cdp.Animation.seekAnimations({
            animations: this.animationIDList,
            currentTime: currentTime % this.animationLength,
          })

          framePromises.push(this.captureFrame(currentTime))

          batchStartTime += batchInterval
        }

        currentTime += this.interval
        await this.page.waitForTimeout(this.interval)
      }

      const frames = await Promise.all(framePromises)

      // Remove the last frame if it's identical to the first frame
      if (
        frames.length > 1 &&
        this.areFramesIdentical(frames[0], frames[frames.length - 1])
      ) {
        frames.pop()
      }

      await this.createGif(frames)

      // if (!this.page.isClosed()) await this.page.close()
      this.ffmpeg.stdin.end()
    } catch (error) {
      console.error('Error:', error.message)
    }
  }

  async captureFrame(currentTime) {
    if (!this.page.isClosed()) {
      const screenshot = await this.page.screenshot({
        clip: this.maxBounds,
        omitBackground: true,
        type: 'png',
        encoding: 'binary',
      })

      return sharp(screenshot)
        .resize(
          Math.round(this.maxBounds.width / 2),
          Math.round(this.maxBounds.height / 2)
        )
        .png({ quality: 40, palette: true, colors: 128 })
        .toBuffer()
    }
  }

  async createGif(frames) {
    for (const frame of frames) {
      this.ffmpeg.stdin.write(frame)
    }
  }

  areFramesIdentical(frame1, frame2) {
    return frame1.toString('base64') === frame2.toString('base64')
  }

  /** @param {Protocol.Animation.AnimationStartedEvent} event */
  async animationStarted(event) {
    // Wait until the containerObject variable is set
    await this.selectorPromise

    this.lastAnimationTime = new Date().getTime()

    const animNode = await this.cdp.DOM.resolveNode({
      backendNodeId: event.animation.source.backendNodeId,
    })

    // Check if animation is inside selector
    const result = await this.cdp.Runtime.callFunctionOn({
      functionDeclaration: 'function ' + this.containsNodeHelper.toString(),
      objectId: this.containerObject.object.objectId,
      arguments: [
        {
          objectId: animNode.object.objectId,
        },
      ],
      returnByValue: true,
    })
    if (!result.result.value) {
      return
    }

    await this.cdp.Animation.setPaused({
      animations: [event.animation.id],
      paused: true,
    })
    // Animations are grouped by start time
    const group = this.animationGroups.find(
      (x) => x.startTime === event.animation.startTime
    )

    if (group) {
      group.list.push(event.animation)
    } else {
      const newGroup = {
        startTime: event.animation.startTime,
        list: [event.animation],
      }
      this.animationGroups.push(newGroup)
    }
  }

  // Used to make calls like Animation.enable() instead of client.send('Animation.enable')
  createProxy(client) {
    return new Proxy(
      {},
      {
        get: function (outerTarget, outerProp) {
          return new Proxy(
            {},
            {
              get: function (innerTarget, innerProp) {
                return function (arg) {
                  return client.send(`${outerProp}.${innerProp}`, arg)
                }
              },
            }
          )
        },
      }
    )
  }

  // Passed into Runtime.callFunctionOn
  containsNodeHelper(childNode) {
    return this.contains(childNode)
  }
}

/**
 * Creates a GIF from the recorded animation.
 * @async
 * @function createGif
 * @param {Object} options - The options for creating the GIF.
 * @param {number} options.width - The width of the GIF.
 * @param {number} options.height - The height of the GIF.
 * @param {number} options.framesPerSecond - The number of frames per second for the GIF.
 * @returns {string} - The path of the created GIF.
 */
async function createGif({
  html,
  url,
  width,
  height,
  framesPerSecond,
  selector,
  page,
}) {
  try {
    if (!page) {
      throw new Error('Page instance required')
    }

    const recorder = new WebAnimationRecorder(
      url,
      html,
      width,
      height,
      framesPerSecond,
      selector,
      page
    )

    await recorder.setupBrowser()
    await recorder.gatherAnimations()
    const { uploadPromise } = await recorder.prepareRecording()
    await recorder.record()
    console.log('recorded')
    await uploadPromise
    console.log('uploaded')
    const metadata = {
      width: width || recorder.maxBounds.width,
      height: height || recorder.maxBounds.height,
      framesPerSecond: framesPerSecond,
      animationLength: recorder.animationLength,
      uid: recorder.outputPath.split('/').pop().split('.')[0],
    }
    const mediaUrl = `https://${process.env.MEDIA_URL_HOST}/${metadata.uid}.gif`

    return {
      url: mediaUrl,
      metadata,
    }
  } catch (err) {
    console.log(err)
    return null
  }
}

module.exports = createGif
