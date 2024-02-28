const healthCheck = async (req, res) => {
    return { message: `Healthcheck REST API called on : ${new Date().toISOString()}` };
}

const testEmail = async (req, res) => {
    const { sendEmail } = require('../service/sendgrid');
    const data = {
        userName: 'John Doe',
        email: 'suyashthakur910@gmail.com',
        subject: 'Welcome to Pictify 🎉',
    };
    const templatePath = 'templates/user/welcome.ejs'
    const html = await sendEmail({
        to: data.email,
        subject: data.subject,
        data,
        templatePath,
    });
    res.type('text/html').send(html);
}


const routes = async (fastify, options) => {
    fastify.get('/healthcheck', healthCheck);
    // fastify.get('/test-email', testEmail);
};

module.exports = routes;