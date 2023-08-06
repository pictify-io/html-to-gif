const { nanoid } = require('nanoid');

const uid = () => {
    return nanoid('123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 10);
}

module.exports = uid;