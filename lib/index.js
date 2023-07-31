const fs = require('fs');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

class WebAnimationRecorder {
  constructor() {
    this.selector = 'html'; // Capture the entire HTML content
    this.url = `file://${__dirname}/test.html`; // Replace 'https://example.com' with your desired website URL
    this.framesPerSecond = 30; // Replace 30 with your desired frames per second
    this.animationIndex = 0;
  }

  async setupBrowser() {
    this.browser = await puppeteer.launch({
      headless: 'new', // Notes about disabling headless mode are in the comments
    });
    this.page = await this.browser.newPage();

    this.client = await this.page.target().createCDPSession();
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
        visible: false,
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
    await this.page.goto(this.url, { waitUntil: 'networkidle2' });

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
    console.log('Total animations found:', this.animationGroups.length);

    if (this.animationIndex > this.animationGroups.length - 1) {
      throw new Error('Animation index provided is greater than total animations');
    }

    // Figure out how long the animation lasts
    this.animationLength = this.animationGroups[this.animationIndex].list.reduce(function (a, b) {
      return Math.max(a, b.source.delay + b.source.duration);
    }, 0); // Add 1 second to the end to ensure animation completes

    console.log('Animation length:', this.animationLength);

    const area = await this.page.$(this.selector);
    const areaElement = await area.asElement();
    if (!areaElement) {
      throw new Error('Element not found');
    }
    console.log('Area:', areaElement);

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

    this.ffmpeg = spawn('ffmpeg', [
      '-y', // Overwrite output file
      '-framerate',
      this.framesPerSecond,
      '-f',
      'image2pipe',
      '-i',
      '-',
      '-vf',
      `scale=${this.maxBounds.width}:${this.maxBounds.height}`,
      '-f',
      'gif',
      '-loop',
      '0',
      '-',
      'video.gif',
    ]);

    this.ffmpeg.on('close', (code) => {
      if (code !== 0) {
        console.error('ffmpeg encountered an error. Check ffmpeg.log for more details');
      }
    });

    const logWriteStream = fs.createWriteStream('ffmpeg.log');

    this.ffmpeg.stdout.pipe(logWriteStream);
    this.ffmpeg.stderr.pipe(logWriteStream);
  }

  // async record() {
  //   let currentTime = 0;
  //   let lastPercentage;
  //   const screenshotBatch = [];
  //   const batchInterval = Math.floor(1000 / this.framesPerSecond);
  //   let batchStartTime = 0;
  //   // Log progress
  //   const progressInterval = setInterval(() => {
  //     lastPercentage = Math.round((currentTime / this.animationLength) * 100);
  //     console.log(`${lastPercentage}% ✅`);
  //   }, 3000);

  //   console.log('Recording started');

  //   // Actually make screenshots
  //   while (currentTime < this.animationLength) {
  //     await this.cdp.Animation.seekAnimations({
  //       animations: this.animationIDList,
  //       currentTime: currentTime,
  //     });

  //     if (currentTime >= batchStartTime) {
  //       const pic = await this.page.screenshot({
  //         omitBackground: true,
  //         clip: this.maxBounds,
  //       });
  //       screenshotBatch.push(pic);

  //       batchStartTime += batchInterval;
  //     }

  //     currentTime = currentTime + this.interval;
  //   }

  //   for (const pic of screenshotBatch) {
  //     this.ffmpeg.stdin.write(pic);
  //   }
    
  //   clearInterval(progressInterval);
  //   if (lastPercentage !== 100) console.log('100% ✅');
  //   await this.browser.close();
  //   this.ffmpeg.stdin.end();
  //   console.log('Recording is available at video.gif');
  // }

  async record() {
    let currentTime = 0;
    let lastPercentage;
    const screenshotPromises = []; // Array to store screenshot promises
    const batchInterval = Math.floor(1000 / this.framesPerSecond);
    let batchStartTime = 0;
  
    // Log progress
    const progressInterval = setInterval(() => {
      lastPercentage = Math.round((currentTime / this.animationLength) * 100);
      console.log(`${lastPercentage}% ✅`);
    }, 3000);
  
    console.log('Recording started');
  
    // Actually make screenshots
    while (currentTime < this.animationLength) {
      if (currentTime >= batchStartTime) {
        // Queue up screenshot requests for multiple timestamps in parallel
        console.log('Queueing screenshot request for', currentTime);
        console.log('Batch start time', batchStartTime);
        console.log('Batch interval', batchInterval);
        screenshotPromises.push(
          this.cdp.Animation.seekAnimations({
            animations: this.animationIDList,
            currentTime: currentTime,
          })
            .then(() => this.page.waitForTimeout(200)) // Wait for a short time to allow the animation to update
            .then(() =>
              this.page.screenshot({
                omitBackground: true,
                clip: this.maxBounds,
              })
            )
        );
  
        batchStartTime += batchInterval;
      }
  
      currentTime = currentTime + this.interval;
    }
  
    // Wait for all the parallel screenshot requests to finish
    const screenshotBatch = await Promise.all(screenshotPromises);
  
    for (const pic of screenshotBatch) {
      this.ffmpeg.stdin.write(pic);
    }
  
    clearInterval(progressInterval);
    if (lastPercentage !== 100) console.log('100% ✅');
    await this.browser.close();
    this.ffmpeg.stdin.end();
    console.log('Recording is available at video.gif');
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

async function run() {
  const recorder = new WebAnimationRecorder();
  await recorder.setupBrowser();
  await recorder.gatherAnimations();
  await recorder.prepareRecording();
  await recorder.record();
}
run();

// Get stack traces in case the program crashes
process.on('unhandledRejection', (err) => {
  throw err;
});
