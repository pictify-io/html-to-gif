const healthCheck = async (req, res) => {
    return { message: `Healthcheck REST API called on : ${new Date().toISOString()}` };
}

const routes = async (fastify, options) => {
    fastify.get('/healthcheck', healthCheck);
};

module.exports = routes;