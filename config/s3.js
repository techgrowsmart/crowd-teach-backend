// config/s3.js
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// Upload base64 image to S3
async function uploadBase64ImageToS3(base64Data, fileName) {
    try {
        // Extract the base64 data (remove the data:image/...;base64, prefix)
        const base64String = base64Data.replace(/^data:image\/\w+;base64,/, '');
        
        // Convert base64 to buffer
        const buffer = Buffer.from(base64String, 'base64');
        
        // Determine file extension from base64 data
        const mimeType = base64Data.match(/^data:image\/(\w+);base64,/);
        const extension = mimeType ? mimeType[1] : 'jpg';
        
        // Generate unique filename
        const key = `post-images/${Date.now()}-${fileName}.${extension}`;
        
        // Upload to S3
        const command = new PutObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME || 'crowdteach-app-s3',
            Key: key,
            Body: buffer,
            ContentType: `image/${extension}`
        });
        
        await s3.send(command);
        
        // Return the public URL
        const region = process.env.AWS_REGION || 'eu-north-1';
        const bucket = process.env.S3_BUCKET_NAME || 'crowdteach-app-s3';
        return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
    } catch (error) {
        console.error('❌ Error uploading to S3:', error);
        throw new Error('Failed to upload image to S3');
    }
}

module.exports = { s3, uploadBase64ImageToS3 };
