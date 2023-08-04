const AWS = require('aws-sdk');
const env = require('dotenv');
const stream = require('stream');

env.config();

const s3 = new AWS.S3({
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const generateKey = (fileExtension) => {
    const randomId = Math.random().toString(36).substring(2, 7);
    const timestamp = Date.now();
    return `${randomId}-${timestamp}.${fileExtension}`;
};

const getUploadStream = (fileExtension) => {
    const key = generateKey(fileExtension);
    const pass = new stream.PassThrough();
    return {
        writeStream: pass,
        promise: s3.upload({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key,
            Body: pass,
            public: true,
            ContentDisposition: 'attachment'
        }).promise(),
        key: key
    };
};

module.exports = {
    getUploadStream
};
