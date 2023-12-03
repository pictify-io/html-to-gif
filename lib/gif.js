const fs = require('fs');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
const sharp = require('sharp');
const { getUploadStream } = require('../service/aws');

class WebAnimationRecorder {
    constructor(url, html, width, height, framesPerSecond) {
    this.selector = 'html'; // Capture the entire HTML content
        // this.url = url;
      this.url = url || `file://${__dirname}/test.html`; // Replace 'https://example.com' with your desired website URL
        this.framesPerSecond = framesPerSecond || 18; // Replace 30 with your desired frames per second
    this.animationIndex = 0;
    this.outputPath = null;
    this.html = html;
        this.width = width;
        this.height = height;
  }



  async setupBrowser() {
      const browserConfig = {
        headless: 'new',
      }
      if (this.width && this.height) {
          browserConfig.defaultViewport = { width: this.width, height: this.height }
      }
      this.browser = await puppeteer.launch(browserConfig);
      this.page = await this.browser.newPage();
    this.client = await this.page.target().createCDPSession();
      await this.client.send('Animation.enable');
    this.cdp = this.createProxy(this.client); // Make calls like Animation.enable() instead of client.send('Animation.enable')
  }

  async gatherAnimations() {
    /** @typedef AnimationGroup
     * @prop {number} startTime
     * @prop {Array<Protocol.Animation.Animation>} list
     */

    /** @type Array<AnimationGroup> */
    this.animationGroups = [];
    this.lastAnimationTime = null;

    this.containerObject = null;
    this.selectorPromise = new Promise(async (resolve) => {
      console.log('Waiting for selector to become active');
      await this.page.waitForSelector(this.selector, {
          visible: true,
        timeout: 10000,
      });

      console.log('Gathering animations');

      const rootNode = await this.cdp.DOM.getDocument();
      const containerNode = await this.cdp.DOM.querySelector({
        nodeId: rootNode.root.nodeId,
        selector: this.selector,
      });
      this.containerObject = await this.cdp.DOM.resolveNode({ nodeId: containerNode.nodeId });
      resolve();
    });

    const animationStartedCallback = this.animationStarted.bind(this);
    this.client.on('Animation.animationStarted', animationStartedCallback);

    await this.cdp.Animation.enable();
      await this.cdp.Animation.setPlaybackRate({ playbackRate: 1 });
      if (this.html) { await this.page.setContent(this.html, { waitUntil: 'networkidle2' }) }
      else {
      await this.page.goto(this.url, { waitUntil: 'networkidle2' });
    }

    await new Promise((resolve) => {
      const waitInterval = setInterval(() => {
        if (this.lastAnimationTime !== null && new Date().getTime() > this.lastAnimationTime + 2000) {
          clearInterval(waitInterval);
          resolve();
        }
      }, 1000);
    });

    this.client.removeListener('Animation.animationStarted', animationStartedCallback);
  }

  async prepareRecording() {
    console.log('Calculating animation bounds');
    let currentTime = 0;

    if (this.animationIndex > this.animationGroups.length - 1) {
      throw new Error('Animation index provided is greater than total animations');
    }

    // Figure out how long the animation lasts
    this.animationLength = this.animationGroups[this.animationIndex].list.reduce(function (a, b) {
      return Math.max(a, b.source.delay + b.source.duration);
    }, 0); // Add 1 second to the end to ensure animation completes

    const area = await this.page.$(this.selector);
    const areaElement = await area.asElement();
    if (!areaElement) {
      throw new Error('Element not found');
    }

    this.animationIDList = this.animationGroups[this.animationIndex].list.map((x) => x.id);

    this.interval = 1000 / this.framesPerSecond;
    this.maxBounds = {
      width: 0,
      height: 0,
      x: Infinity,
      y: Infinity,
    };

    // Calculate max bounds of animation so recording captures the whole animation
    while (currentTime < this.animationLength) {
      await this.cdp.Animation.seekAnimations({
        animations: this.animationIDList,
        currentTime: currentTime,
      });

      const boundingBoxes = await this.page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('html'));
        return elements.map((element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x, y, width, height };
        });
      });

      boundingBoxes.forEach((bbox) => {
        this.maxBounds.width = Math.round(Math.max(bbox.x + bbox.width, this.maxBounds.width)) || 800;
        this.maxBounds.height = Math.round(Math.max(bbox.y + bbox.height, this.maxBounds.height)) || 800;
        this.maxBounds.x = Math.round(Math.min(bbox.x, this.maxBounds.x));
        this.maxBounds.y = Math.round(Math.min(bbox.y, this.maxBounds.y));
      });

      currentTime = currentTime + this.interval;
    }

    // Make height and width even for ffmpeg
    if (this.maxBounds.height % 2 !== 0) this.maxBounds.height++;
    if (this.maxBounds.width % 2 !== 0) this.maxBounds.width++;

    console.log('Max bounds:', this.maxBounds);

    // Add a delay after the animation to ensure it completes
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const { writeStream, promise, key } = getUploadStream('gif');

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
      '-',
    ]);

    this.ffmpeg.stdout.pipe(writeStream);

    this.outputPath = `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${key}`;

    console.log('s3 url', `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${key}`);


    this.ffmpeg.on('close', (code) => {
      if (code !== 0) {
        console.error('ffmpeg encountered an error. Check ffmpeg.log for more details');
      }
    });

    return { uploadPromise: promise };
  }

  async record() {
      try {
          let currentTime = 0;
          let lastPercentage;
          const batchInterval = Math.floor(1000 / this.framesPerSecond);
          let batchStartTime = 0;
  
          // Log progress
          const progressInterval = setInterval(() => {
              lastPercentage = Math.round((currentTime / this.animationLength) * 100);
            console.log(`${lastPercentage}% ✅`, currentTime, this.animationLength);
        }, 3000);
  
          console.log('Recording started');
  
          // While loop to handle screenshot requests sequentially
          while (currentTime < this.animationLength) {
              if (currentTime >= batchStartTime) {
                const animation = await this.cdp.Animation.seekAnimations({
                  animations: this.animationIDList,
                  currentTime: currentTime,
                });

                try {
                if (!this.page.isClosed()) {
                    const pic = await this.page.screenshot({
                        omitBackground: true,
                        clip: this.maxBounds,
                    });

              // Resize and compress the image before piping to ffmpeg
                    const resizedPic = await sharp(pic)
                        .resize(Math.round(this.maxBounds.width / 2.5), Math.round(this.maxBounds.height / 2.5))
                        .png({ quality: 20, palette: true })
                        .toBuffer();

                    this.ffmpeg.stdin.write(resizedPic);
                }
            } catch (err) {
                if (!this.page.isClosed()) {
                  console.error('Error capturing screenshot:', err.message);
                }
            }
  
                batchStartTime += batchInterval;
            }
  
            currentTime += this.interval;

            // Wait for the next frame before continuing
            await this.page.waitForTimeout(this.interval);
        }

          clearInterval(progressInterval);
          console.log('100% ✅');
          if (!this.page.isClosed()) await this.page.close();
          this.ffmpeg.stdin.end();
          console.log('GIF is completed');
      } catch (error) {
          console.error('Error:', error.message);
      }
  }



  /** @param {Protocol.Animation.AnimationStartedEvent} event */
  async animationStarted(event) {
    // Wait until the containerObject variable is set
    await this.selectorPromise;

    this.lastAnimationTime = new Date().getTime();

    const animNode = await this.cdp.DOM.resolveNode({ backendNodeId: event.animation.source.backendNodeId });

    // Check if animation is inside selector
    const result = await this.cdp.Runtime.callFunctionOn(
      {
        functionDeclaration: 'function ' + this.containsNodeHelper.toString(),
        objectId: this.containerObject.object.objectId,
        arguments: [
          {
            objectId: animNode.object.objectId,
          },
        ],
        returnByValue: true,
      },
    );
    if (!result.result.value) {
      return;
    }

    await this.cdp.Animation.setPaused({ animations: [event.animation.id], paused: true });
    // Animations are grouped by start time
    const group = this.animationGroups.find((x) => x.startTime === event.animation.startTime);

    if (group) {
      group.list.push(event.animation);
    } else {
      const newGroup = {
        startTime: event.animation.startTime,
        list: [event.animation],
      };
      this.animationGroups.push(newGroup);
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
                  return client.send(`${outerProp}.${innerProp}`, arg);
                };
              },
            },
          );
        },
      },
    );
  }

  // Passed into Runtime.callFunctionOn
  containsNodeHelper(childNode) {
    return this.contains(childNode);
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
}) {
  const recorder = new WebAnimationRecorder(
    url,
    html,
    width,
    height,
    framesPerSecond,
  );
  await recorder.setupBrowser();

  let isAnimationPresent = false;
  let isCSSAnimationPresent = false;

  // Detect DOM changes
  await recorder.page.evaluateOnNewDocument(() => {
    const observer = new MutationObserver(() => {
      console.log('DOM changed');
      window.__animationRecorder.lastAnimationTime = new Date().getTime();
    });
    observer.observe(document, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });


    window.__animationRecorder = {
      lastAnimationTime: null,
    };
  });

  await recorder.page.on('console', (msg) => {
    if (msg.text() === 'DOM changed') {
      animationPresent = true;
    }
  });

  const cssAnimation = await Promise.race([
    recorder.gatherAnimations(),
    new Promise((resolve, reject) => {
      setTimeout(() => {
        isCSSAnimationPresent = false;
        resolve('NO_ANIMATION');
      }, 1000);
    }),
  ]);

  if (!isCSSAnimationPresent) {
    await new Promise((resolve) => setTimeout(() => {
      console.log('Waiting for animation to start');
      resolve();
    }, 1000));
  }

  console.log('cssAnimation', cssAnimation, isAnimationPresent, isCSSAnimationPresent);


  const { uploadPromise } = await recorder.prepareRecording();
  await recorder.record();
  console.log("recorded");
  await uploadPromise;
  console.log("uploaded");
  const metadata = {
    width: this.width || recorder.maxBounds.width,
    height: this.height || recorder.maxBounds.height,
    framesPerSecond: this.framesPerSecond,
    animationLength: recorder.animationLength,

  }
  return {
    url: recorder.outputPath,
    metadata,
  }
}

module.exports = createGif;