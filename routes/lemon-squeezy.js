const User = require('../models/User');
const { convertPlanToSlug } = require('../util/plan');

const webhook = async (req, res) => {
  try {
    const payload = req.body;

    if (!payload || !payload.meta || !payload.data || !payload.data.attributes) {
      return res.status(400).send('Invalid payload');
    }

    const eventName = payload.meta.event_name;
    const userEmail = payload.data.attributes.user_email;
    const userName = payload.data.attributes.user_name;

    console.dir({ payload }, { depth: null });

    let user = await User.findOne({ email: userEmail });

    if (!user) {
      user = new User({ email: userEmail, name: userName });
    }

    switch (eventName) {
      case 'subscription_created':
      case 'subscription_updated':
        const planName = payload.data.attributes.product_name;
        if (user.currentPlan !== planName) {
          const proratedUsage = user.calculateProration(convertPlanToSlug(planName));
          user.currentPlan = planName;
          user.usage = { count: 0, lastReset: new Date(), proratedUsage: proratedUsage };
          await user.save();
        }
        break;

      case 'subscription_resumed':
        if (user.currentPlan !== convertPlanToSlug('Starter')) {
          user.currentPlan = payload.data.attributes.product_name;
          user.usage = { count: 0, lastReset: new Date() };
          await user.save();
        }
        break;

      case 'subscription_cancelled':
      case 'subscription_paused':
        const proratedUsage = user.calculateProration(convertPlanToSlug('Starter'));
        user.currentPlan = 'Starter';
        user.usage = { count: 0, lastReset: new Date(), proratedUsage: proratedUsage };
        await user.save();
        break;

      default:
        console.log(`Unhandled event type: ${eventName}`);
        return res.status(200).send('Unhandled event type');
    }

    res.status(200).send('Webhook processed successfully');
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(200).send('Internal Server Error');
  }
};

module.exports = webhook;


module.exports = async (fastify) => {
  fastify.post('/webhook', webhook);
};

module.exports.autoPrefix = '/lemon-squeezy';