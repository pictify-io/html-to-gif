const {
  lemonSqueezySetup,
  listProducts,
} = require('@lemonsqueezy/lemonsqueezy.js')
const { getRequestLimit, convertPlanToSlug } = require('../util/plan')
const { LRUCache } = require('lru-cache')

// **Free**: 50 requests per month - Starter

// **$14**: 1,500 requests per month - Basic

// **$29**: 3,500 requests per month - Standard

// **$49**: 7,500 requests per month - **Professional**

// **$69**: 12,000 requests per month - **Advanced**

// **$99**: 20,000 requests per month - **Pro Plus**

// **$149**: 40,000 requests per month - Business

// **$199**: 60,000 requests per month - **Business Plus**

// **$249**: 80,000 requests per month - **Premium**

// **$349**: 120,000 requests per month - **Premium Plus**

// **$449**: 150,000 requests per month - **Enterprise**

// **$649**: 250,000 requests per month - **Enterprise Plus**

// **$899**: 400,000 requests per month - Elite

// **$1,299**: 600,000 requests per month - Elite Plus

//   ** $1, 799 **: 1,000,000 requests per month - Ultimate

lemonSqueezySetup({
  apiKey: process.env.LEMONSQUEEZY_API_KEY,
  onError: (error) => {
    console.error(error)
  },
})

const cache = new LRUCache({
  max: 100,
  ttl: 1000 * 60 * 60 * 24, // 24 hours
})

const getProducts = async (fastify, request, reply) => {
  const cachedProducts = cache.get('products')
  if (cachedProducts) {
    return { success: true, data: cachedProducts }
  }

  products = await listProducts({
    page: { number: 1, size: 20 },
    filter: { storeId: 110208 },
  })

  products = products.data.data
    .map((product) => {
      return {
        id: product.attributes.id,
        name: product.attributes.name,
        price: product.attributes.price,
        price_formatted: product.attributes.price_formatted,
        purchase_url: product.attributes.buy_now_url,
        request_per_month: getRequestLimit(
          convertPlanToSlug(product.attributes.name)
        ),
      }
    })
    .sort((a, b) => a.price - b.price)
  products = [
    {
      id: 'free',
      name: 'Starter',
      price: 0,
      price_formatted: 'Free',
      purchase_url: null,
      request_per_month: 50,
    },
    ...products,
  ]

  cache.set('products', products)
  return { success: true, data: products }
}

module.exports = async (fastify) => {
  fastify.get('/', async (request, reply) => {
    return getProducts(fastify, request, reply)
  })
}

module.exports.autoPrefix = '/products'
