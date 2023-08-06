require('dotenv').config();
const db = require('./db');

db();

const port = process.env.PORT || 3001;

const fastify = require('fastify')({
    logger: false
});

if (process.env.NODE_ENV !== 'production') {
    fastify.register(require('@fastify/cors'), {
        // put your options here
    });
}

fastify.register(require('./routes/test'));

fastify.listen({ port }, (err, address) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server listening on ${address}`);
});