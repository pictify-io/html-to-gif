const User = require('../models/User');
const decorateUser = require('../plugins/decorate_user');
const { convertPlanToSlug } = require('../util/plan');
const { lemonSqueezySetup, getCustomer } = require('@lemonsqueezy/lemonsqueezy.js');

lemonSqueezySetup({
  apiKey: process.env.LEMONSQUEEZY_API_KEY,
  onError: (error) => {
    console.error(error);
  }
});

const webhook = async (req, res) => {
  try {
    const payload = req.body;

    if (!payload || !payload.meta || !payload.data || !payload.data.attributes) {
      return res.status(400).send('Invalid payload');
    }

    const eventName = payload.meta.event_name;
    const userEmail = payload.data.attributes.user_email;
    const userName = payload.data.attributes.user_name;
    const lemonSqueezyCustomerId = payload.data.attributes.customer_id;
    let user = await User.findOne({ email: userEmail });

    if (!user) {
      user = new User({ email: userEmail, name: userName });
    }

    switch (eventName) {
      case 'subscription_created':
        const planName = payload.data.attributes.product_name;
        if (user.currentPlan !== planName) {
          // const proratedUsage = user.calculateProration(convertPlanToSlug(planName));
          user.currentPlan = planName;
          user.lemonSqueezyCustomerId = lemonSqueezyCustomerId;
          // user.usage = { count: 0, lastReset: new Date() };
          await user.save();
        }
        break;
      case 'subscription_updated':
        const subscriptionStatus = payload.data.attributes.status;
        if (subscriptionStatus === 'active') {
          const planName = payload.data.attributes.product_name;
          if (user.currentPlan !== planName) {
            // const proratedUsage = user.calculateProration(convertPlanToSlug(planName));
            user.currentPlan = planName;
            // user.usage.proratedUsage = proratedUsage;
            await user.save();
          }
        }
        if (subscriptionStatus === 'paused') {
          const proratedUsage = user.calculateProration(convertPlanToSlug('Starter'));
          user.currentPlan = 'Starter';
          user.usage = { proratedUsage: proratedUsage };
          await user.save();
        }

        if (subscriptionStatus === 'cancelled') {
          const proratedUsage = user.calculateProration(convertPlanToSlug('Starter'));
          user.currentPlan = 'Starter';
          user.usage.proratedUsage = proratedUsage;
          await user.save();
        }
        break;

      case 'subscription_resumed':
        if (user.currentPlan !== convertPlanToSlug('Starter')) {
          user.currentPlan = payload.data.attributes.product_name;
          // user.usage = { count: 0, lastReset: new Date() };
          await user.save();
        }
        break;

      case 'subscription_cancelled':
      case 'subscription_paused':
        const proratedUsage = user.calculateProration(convertPlanToSlug('Starter'));
        user.currentPlan = 'Starter';
        user.usage.proratedUsage = proratedUsage;
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

const getCustomerPortal = async (req, res) => {
  const user = req.user;

  if (!user.lemonSqueezyCustomerId) {
    return res.status(400).send('User does not have a customer ID');
  }

  const customer = await getCustomer(user.lemonSqueezyCustomerId);
  const portalLink = customer?.data?.data?.attributes?.urls?.customer_portal || null;

  res.status(200).send({ portalLink });
}

module.exports = webhook;


module.exports = async (fastify) => {

  fastify.register(async (fastify) => {
    fastify.post('/webhook', webhook);
  });


  fastify.register(async (fastify) => {
    fastify.register(decorateUser);
    fastify.get('/customer-portal', getCustomerPortal);
  });
};

module.exports.autoPrefix = '/lemon-squeezy';