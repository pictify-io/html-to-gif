const crypto = require('crypto');

module.exports = async (len = 64) => {
    if (length % 2 !== 0) {
        throw new Error('API key length must be an even number for hexadecimal representation.');
    }

    const bytes = crypto.randomBytes(len / 2);
    const apiKey = bytes.toString('hex');

    return apiKey;
};