const { lemonSqueezySetup, listProducts } = require('@lemonsqueezy/lemonsqueezy.js');


lemonSqueezySetup({
  apiKey: process.env.LEMONSQUEEZY_API_KEY,
  onError: (error) => {
    console.error(error);
  }
});



const getProducts = async (request, reply) => {
  const products = await listProducts({
    page: { number: 1, size: 20 },
    filter: { storeId: 110208 }
  });
  return products.data;
};


module.exports = async (fastify) => {
  fastify.get('/', getProducts);
}

module.exports.autoPrefix = '/products';