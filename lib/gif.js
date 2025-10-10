const { spawn } = require('child_process')
const sharp = require('sharp')
const { getUploadStream } = require('../service/aws')

class NoFramesCapturedError extends Error {
  constructor(message = 'No frames captured from capture_frame events') {
    super(message)
    this.name = 'NoFramesCapturedError'
    this.code = 'NO_FRAMES_CAPTURED'
  }
}

class InvalidQualityPresetError extends Error {
  constructor(message = 'Invalid quality preset') {
    super(message)
    this.name = 'InvalidQualityPresetError'
    this.code = 'INVALID_QUALITY_PRESET'
  }
}

const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({
    key: 'low',
    ffmpeg: Object.freeze({
      palettegen: Object.freeze({
        maxColors: 128,
        statsMode: 'single',
      }),
      paletteuse: Object.freeze({
        dither: 'bayer',
        bayerScale: 3,
      }),
    }),
    sharp: Object.freeze({
      resizeKernel: 'nearest',
      png: Object.freeze({
        palette: true,
        colors: 128,
        compressionLevel: 6,
        adaptiveFiltering: false,
      }),
    }),
  }),
  medium: Object.freeze({
    key: 'medium',
    ffmpeg: Object.freeze({
      palettegen: Object.freeze({
        maxColors: 192,
        statsMode: 'diff',
      }),
      paletteuse: Object.freeze({
        dither: 'bayer',
        bayerScale: 2,
      }),
    }),
    sharp: Object.freeze({
      resizeKernel: 'lanczos3',
      png: Object.freeze({
        palette: true,
        colors: 192,
        compressionLevel: 8,
        adaptiveFiltering: true,
      }),
    }),
  }),
  high: Object.freeze({
    key: 'high',
    ffmpeg: Object.freeze({
      palettegen: Object.freeze({
        maxColors: 256,
        statsMode: 'diff',
      }),
      paletteuse: Object.freeze({
        dither: 'bayer',
        bayerScale: 1,
      }),
    }),
    sharp: Object.freeze({
      resizeKernel: 'lanczos3',
      png: Object.freeze({
        palette: true,
        colors: 256,
        compressionLevel: 9,
        adaptiveFiltering: true,
      }),
    }),
  }),
})

function normalizeQualityPresetName(quality) {
  if (quality === undefined || quality === null) {
    return 'medium'
  }
  const normalized = String(quality).trim().toLowerCase()
  return normalized || 'medium'
}

function resolveQualityPreset(quality) {
  const key = normalizeQualityPresetName(quality)
  const preset = QUALITY_PRESETS[key]
  if (!preset) {
    throw new InvalidQualityPresetError(
      `Invalid quality preset: ${quality}`
    )
  }
  return { key, preset }
}

function buildPaletteFilter(preset) {
  const palettegenArgs = []
  const paletteuseArgs = []

  if (preset.ffmpeg.palettegen.maxColors) {
    palettegenArgs.push(`max_colors=${preset.ffmpeg.palettegen.maxColors}`)
  }
  if (preset.ffmpeg.palettegen.statsMode) {
    palettegenArgs.push(`stats_mode=${preset.ffmpeg.palettegen.statsMode}`)
  }

  if (preset.ffmpeg.paletteuse.dither) {
    paletteuseArgs.push(`dither=${preset.ffmpeg.paletteuse.dither}`)
  }
  if (
    preset.ffmpeg.paletteuse.bayerScale !== undefined &&
    preset.ffmpeg.paletteuse.bayerScale !== null
  ) {
    paletteuseArgs.push(
      `bayer_scale=${preset.ffmpeg.paletteuse.bayerScale}`
    )
  }

  const palettegenSuffix = palettegenArgs.length
    ? `=${palettegenArgs.join(':')}`
    : ''
  const paletteuseSuffix = paletteuseArgs.length
    ? `=${paletteuseArgs.join(':')}`
    : ''

  return `split[s0][s1];[s0]palettegen${palettegenSuffix}[p];[s1][p]paletteuse${paletteuseSuffix}`
}

const ENTERPRISE_RECORDER_SYMBOL = Symbol.for('html-to-gif.enterpriseRecorder')
const ENTERPRISE_BINDINGS_FLAG = Symbol.for('html-to-gif.enterpriseBindingsInstalled')

async function ensureEnterpriseBindings(page) {
  if (page[ENTERPRISE_BINDINGS_FLAG]) {
    return
  }

  await page.exposeFunction('enterpriseCaptureFrame', async () => {
    const recorder = page[ENTERPRISE_RECORDER_SYMBOL]
    if (!recorder) {
      return
    }
    return recorder.handleCaptureFrameRequest()
  })

  await page.exposeFunction('enterpriseStopCapture', async () => {
    const recorder = page[ENTERPRISE_RECORDER_SYMBOL]
    if (!recorder) {
      return
    }
    return recorder.handleStopCaptureRequest()
  })

  page[ENTERPRISE_BINDINGS_FLAG] = true
}

// Create a browser pool

class WebAnimationRecorder {
  constructor({
    url,
    html,
    width,
    height,
    framesPerSecond,
    selector,
    page,
    quality,
  }) {
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
    const { key: resolvedKey, preset: resolvedPreset } = resolveQualityPreset(
      quality
    )
    this.quality = resolvedKey
    this.qualityPreset = resolvedPreset
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

    const paletteFilter = buildPaletteFilter(this.qualityPreset)

    // Optimized FFmpeg settings for faster GIF generation
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
      // Optimized: reduced colors, faster palette generation
      paletteFilter,
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
        encoding: 'binary'
        // Note: quality and optimizeForSpeed are not supported for PNG screenshots
      })

      // Optimized Sharp processing
      const kernel = this.qualityPreset?.sharp?.resizeKernel || 'nearest'
      const pngOptions = this.qualityPreset?.sharp?.png || {
        quality: 50,
        palette: true,
        colors: 128,
        compressionLevel: 6,
        adaptiveFiltering: false,
      }
      return sharp(screenshot)
        .resize(
          Math.round(this.maxBounds.width / 2),
          Math.round(this.maxBounds.height / 2),
          {
            fit: 'inside',
            withoutEnlargement: true,
            kernel,
          }
        )
        .png(pngOptions)
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

class EventDrivenGifRecorder {
  constructor({
    url,
    width,
    height,
    framesPerSecond,
    selector,
    page,
    timeout,
    frameDurationSeconds = 3,
    timeCompressionFactor = 8,
    onCaptureComplete,
    quality,
  }) {
    this.url = url
    this.width = width
    this.height = height
    this.framesPerSecond = framesPerSecond || 18
    this.frameDurationSeconds = frameDurationSeconds > 0 ? frameDurationSeconds : 1
    this.selector = selector || 'html'
    this.page = page
    this.timeout = Number.isFinite(timeout) && timeout > 0 ? timeout : null
    this.outputPath = null
    this.frameCaptureCount = 0
    this.stopped = false
    this.initializedClip = null
    this.captureQueue = Promise.resolve()
    this.timeCompressionFactor = timeCompressionFactor > 0 ? timeCompressionFactor : 1
    this.animationClient = null
    this.onCaptureComplete = onCaptureComplete
    this.cleanupPerformed = false
    this.encoder = null
    this.encoderReady = false
    this.encoderDonePromise = null
    this.uploadPromise = null
    this.keyBase = null
    this.clipForEncoder = null
    this.finalGifMetadata = null
    this.outputPath = null
    // Optimization: parallel frame processing
    this.frameProcessingQueue = []
    this.maxParallelFrames = 3 // Process up to 3 frames in parallel
    const { key: resolvedKey, preset: resolvedPreset } = resolveQualityPreset(
      quality
    )
    this.quality = resolvedKey
    this.qualityPreset = resolvedPreset
    this.captureHoldCount = 0
    const safeCompression = this.timeCompressionFactor > 0 ? this.timeCompressionFactor : 1
    const slowdownFactor = 1 / safeCompression
    this.captureSlowdownRate = Math.min(1, Math.max(0.02, slowdownFactor))
  }

  async setupPage() {
    if (!this.page) {
      throw new Error('Page instance required')
    }

    await ensureEnterpriseBindings(this.page)

    if (this.width && this.height) {
      await this.page.setViewport({
        width: this.width,
        height: this.height,
      })
    }

    if (!this.page._enterpriseTimingInjected) {
      await this.page.evaluateOnNewDocument(() => {
        if (window.__enterpriseTiming) return
        const originals = {}

        const ensureOriginal = (prop) => {
          if (typeof window[prop] === 'function' && !originals[prop]) {
            originals[prop] = window[prop].bind(window)
          }
        }

        const timerOverrides = {
          factor: 1,
          originals,
          apply(newFactor) {
            this.factor = newFactor > 0 ? newFactor : 1

            const wrap = (name) => {
              ensureOriginal(name)
              if (!originals[name]) return

              if (name === 'requestAnimationFrame') {
                window[name] = function (callback) {
                  return originals[name](function wrappedRAF(time) {
                    return callback(time * timerOverrides.factor)
                  })
                }
              } else {
                window[name] = function (callback, delay, ...args) {
                  const effectiveDelay = Math.max((delay || 0) / timerOverrides.factor, 0)
                  return originals[name](callback, effectiveDelay, ...args)
                }
              }
            }

            wrap('setTimeout')
            wrap('setInterval')
            wrap('setImmediate')
            wrap('requestAnimationFrame')
          },
          reset() {
            Object.entries(originals).forEach(([name, fn]) => {
              window[name] = fn
            })
            this.factor = 1
          },
        }

        window.__enterpriseTiming = timerOverrides
      })
      this.page._enterpriseTimingInjected = true
    }

    if (!this.animationClient) {
      this.animationClient = await this.page.target().createCDPSession()
      await this.animationClient.send('Animation.enable')
    }

    const factor = this.timeCompressionFactor
    await this.animationClient.send('Animation.setPlaybackRate', { playbackRate: factor })

    // Wait for both DOM and network to ensure all elements are loaded
    await this.page.goto(this.url, {
      waitUntil: ['domcontentloaded', 'networkidle2'],
      timeout: 30000
    })

    // Additional wait to ensure dynamic content is rendered
    await this.page.waitForTimeout(100)

    await this.page.evaluate((compressionFactor) => {
      window.__enterpriseTiming?.apply?.(compressionFactor)
    }, factor)

    // Clean up any existing exposed functions before re-exposing
    this.page[ENTERPRISE_RECORDER_SYMBOL] = this

    await this.page.evaluate((selector) => {
      const targetSelector = selector
      const captureHandler = async (event) => {
        console.log('message', event)

        const message = event.data
        if (!message) return
        const status = typeof message === 'string' ? message : message.status
        if (status === 'capture_frame') {
          console.log('capture_frame')
          await window.enterpriseCaptureFrame()
        } else if (status === 'end') {
          console.log('end')
          await window.enterpriseStopCapture()
        }
      }
      window.addEventListener('message', captureHandler)
      window.__enterpriseCaptureHandler = captureHandler
      window.__enterpriseCaptureSelector = targetSelector
    }, this.selector)
  }

  async calculateClip() {
    if (this.initializedClip) {
      return this.initializedClip
    }

    const selector = this.selector
    const clipBox = await this.page.evaluate((sel) => {
      const element = document.querySelector(sel)
      if (!element) {
        return null
      }
      const rect = element.getBoundingClientRect()
      return {
        x: Math.max(rect.x, 0),
        y: Math.max(rect.y, 0),
        width: Math.max(rect.width, 2),
        height: Math.max(rect.height, 2),
      }
    }, selector)

    if (!clipBox) {
      throw new Error(`Selector ${selector} not found for capture`)
    }

    if (clipBox.width % 2 !== 0) clipBox.width += 1
    if (clipBox.height % 2 !== 0) clipBox.height += 1

    this.initializedClip = clipBox
    return clipBox
  }

  async listenForEvents() {
    const pollInterval = 10
    const start = Date.now()

    while (!this.stopped) {
      if (this.timeout && Date.now() - start > this.timeout) {
        throw new Error('Timeout waiting for end event')
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }

    await this.finalizeCapture()
  }

  async adjustPlaybackRate(playbackRate) {
    const safeRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1
    const tasks = []
    if (this.animationClient) {
      tasks.push(
        this.animationClient
          .send('Animation.setPlaybackRate', { playbackRate: safeRate })
          .catch((err) => {
            console.error('Error adjusting animation playback rate:', err)
          })
      )
    }
    if (this.page && !this.page.isClosed()) {
      tasks.push(
        this.page
          .evaluate((factor) => {
            window.__enterpriseTiming?.apply?.(factor)
          }, safeRate)
          .catch((err) => {
            console.error('Error adjusting enterprise timing factor:', err)
          })
      )
    }
    if (tasks.length > 0) {
      await Promise.all(tasks)
    }
  }

  async pausePlaybackForCapture() {
    if (!this.page || this.page.isClosed()) return
    this.captureHoldCount += 1
    if (this.captureHoldCount > 1) {
      return
    }
    await this.adjustPlaybackRate(this.captureSlowdownRate)
  }

  async resumePlaybackAfterCapture() {
    if (!this.page || this.page.isClosed()) return
    this.captureHoldCount = Math.max(this.captureHoldCount - 1, 0)
    if (this.captureHoldCount > 0) {
      return
    }
    const factor = this.timeCompressionFactor > 0 ? this.timeCompressionFactor : 1
    await this.adjustPlaybackRate(factor)
  }

  async handleCaptureFrameRequest() {
    if (this.stopped) return

    // Capture immediately before element disappears
    const frameIndex = this.frameCaptureCount++
    const clip = await this.calculateClip()
    await this.ensureEncoder(clip)

    // Process frame in parallel with others
    const framePromise = (async () => {
      await this.pausePlaybackForCapture()
      try {
        return await this.captureAndProcessFrame(clip)
      } finally {
        await this.resumePlaybackAfterCapture()
      }
    })()

    // Add to queue for sequential writing
    this.captureQueue = this.captureQueue.then(async () => {
      if (this.stopped) return
      try {
        const processedFrame = await framePromise
        if (processedFrame && this.encoderReady && this.encoder) {
          this.encoder.stdin.write(processedFrame)
        }
      } catch (err) {
        console.error(`Error processing frame ${frameIndex}:`, err)
      }
    })

    return this.captureQueue
  }

  async handleStopCaptureRequest() {
    this.stopped = true
    await this.captureQueue
  }

  async ensureEncoder(clip) {
    if (this.encoderReady) {
      return
    }

    const playbackFps = 1 / this.frameDurationSeconds
    const { writeStream, promise, key } = getUploadStream('gif')
    this.uploadPromise = promise
    this.keyBase = key.replace(/\.gif$/, '')

    const paletteFilter = buildPaletteFilter(this.qualityPreset)

    // Optimized FFmpeg settings with quality presets
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-f',
      'image2pipe',
      '-framerate',
      playbackFps.toString(),
      '-i',
      '-',
      '-f',
      'gif',
      '-loop',
      '0',
      '-vf',
      paletteFilter,
      '-',
    ])

    ffmpeg.stdout.pipe(writeStream)

    this.encoderDonePromise = new Promise((resolve, reject) => {
      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ffmpeg exited with code ${code}`))
        } else {
          resolve()
        }
      })
      ffmpeg.on('error', reject)
    })

    ffmpeg.on('error', (err) => {
      console.error('ffmpeg process error:', err)
    })

    this.encoder = ffmpeg
    this.encoderReady = true
    this.clipForEncoder = clip
  }

  async processFrameBuffer(frameBuffer, clip) {
    // Optimize Sharp processing: WebP input, PNG output for FFmpeg
    const kernel = this.qualityPreset?.sharp?.resizeKernel || 'lanczos3'
    const pngOptions = this.qualityPreset?.sharp?.png || {
      palette: true,
      colors: 256,
      compressionLevel: 9,
      adaptiveFiltering: true,
    }
    const processed = await sharp(frameBuffer)
      .resize(Math.round(clip.width), Math.round(clip.height), {
        fit: 'inside',
        withoutEnlargement: true,
        kernel,
      })
      .png(pngOptions)
      .toBuffer()

    return processed
  }

  async writeFrameToEncoder(frameBuffer, clip) {
    if (!this.encoderReady || !this.encoder) {
      throw new Error('Encoder not initialized')
    }

    const processed = await this.processFrameBuffer(frameBuffer, clip)
    this.encoder.stdin.write(processed)
  }

  async captureAndProcessFrame(clip) {
    // Capture immediately - no delays, as elements may disappear quickly
    const screenshot = await this.page.screenshot({
      clip,
      omitBackground: true,
      type: 'png',
      encoding: 'binary',
    })

    // Process the frame buffer in parallel
    return await this.processFrameBuffer(screenshot, clip)
  }

  async finalizeCapture() {
    if (this.cleanupPerformed) {
      await this.captureQueue
      return
    }
    this.cleanupPerformed = true
    await this.captureQueue
    try {
      await this.closeEncoder()
      await this.cleanup()
    } finally {
      if (this.page) {
        delete this.page[ENTERPRISE_RECORDER_SYMBOL]
      }
      if (typeof this.onCaptureComplete === 'function') {
        try {
          await this.onCaptureComplete()
        } catch (err) {
          console.error('Error in onCaptureComplete callback:', err)
        }
      }
    }
  }

  async cleanup() {
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.evaluate((defaultFactor) => {
          window.__enterpriseTiming?.apply?.(defaultFactor)
          window.__enterpriseTiming?.reset?.()
          if (window.__enterpriseCaptureHandler) {
            window.removeEventListener('message', window.__enterpriseCaptureHandler)
            delete window.__enterpriseCaptureHandler
          }
          delete window.__enterpriseCaptureSelector
          // Clean up exposed functions
        }, 1)
      }
      if (this.animationClient) {
        try {
          await this.animationClient.send('Animation.setPlaybackRate', { playbackRate: 1 })
        } catch (err) {
          console.error('Error resetting animation playback rate:', err)
        }
        try {
          await this.animationClient.detach()
        } catch (err) {
          console.error('Error detaching animation client:', err)
        }
        this.animationClient = null
      }
    } catch (err) {
      console.error('Error during enterprise capture cleanup:', err)
    } finally {
      this.captureQueue = Promise.resolve()
      this.page = null
    }
  }

  async buildGif() {
    if (!this.finalGifMetadata) {
      throw new NoFramesCapturedError()
    }

    return this.finalGifMetadata
  }

  async closeEncoder() {
    if (!this.encoderReady || !this.encoder) {
      return
    }

    try {
      this.encoder.stdin.end()
    } catch (err) {
      console.error('Error closing ffmpeg stdin:', err)
    }

    try {
      await this.encoderDonePromise
      await this.uploadPromise
      const s3Url = `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${this.keyBase}.gif`
      const mediaUrl = `https://${process.env.MEDIA_URL_HOST}/${this.keyBase}.gif`
      this.outputPath = s3Url

      if (this.frameCaptureCount > 0 && this.clipForEncoder) {
        this.finalGifMetadata = {
          gifUrl: mediaUrl,
          width: this.clipForEncoder.width,
          height: this.clipForEncoder.height,
          frameCount: this.frameCaptureCount,
          animationLength: this.frameCaptureCount * this.frameDurationSeconds,
          frameDurationSeconds: this.frameDurationSeconds,
          framesPerSecond: 1 / this.frameDurationSeconds,
          timeCompressionFactor: this.timeCompressionFactor,
          quality: this.quality,
          uid: this.keyBase,
        }
      }
    } finally {
      this.encoder = null
      this.encoderReady = false
      this.encoderDonePromise = null
      this.uploadPromise = null
    }
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
  quality,
}) {
  try {
    if (!page) {
      throw new Error('Page instance required')
    }

    const recorder = new WebAnimationRecorder({
      url,
      html,
      width,
      height,
      framesPerSecond,
      selector,
      page,
      quality,
    })

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
      timeCompressionFactor: recorder.timeCompressionFactor,
      quality: recorder.quality,
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

async function createGifFromEvents(options) {
  const recorder = new EventDrivenGifRecorder({
    ...options,
    quality: options?.quality,
  })
  try {
    await recorder.setupPage()
    await recorder.listenForEvents()
    const gifData = await recorder.buildGif()
    return {
      url: gifData.gifUrl,
      metadata: {
        width: gifData.width,
        height: gifData.height,
        framesPerSecond: gifData.framesPerSecond,
        frameDurationSeconds: gifData.frameDurationSeconds,
        frameCount: gifData.frameCount,
        animationLength: gifData.animationLength,
        timeCompressionFactor: gifData.timeCompressionFactor,
        quality: gifData.quality,
        uid: gifData.uid,
      },
    }
  } finally {
    await recorder.finalizeCapture()
  }
}

module.exports = createGif
module.exports.createGifFromEvents = createGifFromEvents
module.exports.NoFramesCapturedError = NoFramesCapturedError
module.exports.resolveQualityPreset = resolveQualityPreset
