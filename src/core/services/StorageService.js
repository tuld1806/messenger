const {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  PutBucketPolicyCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

/**
 * Storage Service xu ly luu tru media tren MinIO (chuan S3)
 */
class StorageService {
  constructor(config = {}) {
    // Endpoint noi bo de backend ket noi truc tiep voi MinIO
    this.internalEndpoint =
      config.internalEndpoint ||
      process.env.MINIO_INTERNAL_ENDPOINT ||
      process.env.MINIO_ENDPOINT ||
      'http://127.0.0.1:9000';

    // Endpoint cong khai de client trinh duyet truy cap
    this.publicEndpoint =
      config.publicEndpoint ||
      process.env.MINIO_PUBLIC_ENDPOINT ||
      process.env.MINIO_ENDPOINT ||
      this.internalEndpoint;

    this.region = config.region || process.env.MINIO_REGION || 'us-east-1';
    this.accessKeyId = config.accessKeyId || process.env.MINIO_ACCESS_KEY || '';
    this.secretAccessKey = config.secretAccessKey || process.env.MINIO_SECRET_KEY || '';
    this.bucket = config.bucket || process.env.MINIO_BUCKET || 'messenger-media';
    this.expiresIn = config.expiresIn || 300; // thoi han 5 phut (300 giay)
    this.publicRead =
      config.publicRead !== undefined
        ? config.publicRead
        : process.env.MINIO_PUBLIC_READ === 'true';

    // Client noi bo: dung cho cac thao tac backend voi MinIO
    this.internalClient = new S3Client({
      endpoint: this.internalEndpoint,
      region: this.region,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      },
      forcePathStyle: true, // bat buoc voi MinIO de truy cap bucket theo dang path
    });

    // Client presigner: dung de tinh toan chu ky presigned URL khop voi public endpoint
    this.presignerClient = new S3Client({
      endpoint: this.publicEndpoint,
      region: this.region,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      },
      forcePathStyle: true,
    });
  }

  // Sinh key duy nhat cho file de tranh trung ten
  _generateFileKey(fileName) {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const cleanName = fileName
      ? fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
      : 'file';
    return `${timestamp}-${randomStr}-${cleanName}`;
  }

  // Kiem tra bucket da ton tai chua
  async checkBucketExists(bucketName = this.bucket) {
    try {
      await this.internalClient.send(new HeadBucketCommand({ Bucket: bucketName }));
      return true;
    } catch (err) {
      if (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound') {
        return false;
      }
      throw new Error(`Kiem tra bucket that bai: ${err.message}`);
    }
  }

  // Tu dong tao bucket neu chua co va set policy doc cong khai neu duoc bat
  async ensureBucketExists(bucketName = this.bucket) {
    try {
      const exists = await this.checkBucketExists(bucketName);
      if (!exists) {
        await this.internalClient.send(new CreateBucketCommand({ Bucket: bucketName }));
        console.log(`[MinIO] Da tao bucket moi: ${bucketName}`);

        // Set policy cong khai neu duoc bat de frontend hien thi anh
        if (this.publicRead) {
          try {
            const publicReadPolicy = JSON.stringify({
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Principal: { AWS: ['*'] },
                  Action: ['s3:GetObject'],
                  Resource: [`arn:aws:s3:::${bucketName}/*`],
                },
              ],
            });
            await this.internalClient.send(
              new PutBucketPolicyCommand({
                Bucket: bucketName,
                Policy: publicReadPolicy,
              })
            );
          } catch (policyErr) {
            console.warn('[MinIO] Khong the set public read policy:', policyErr.message);
          }
        }
      }
      return true;
    } catch (err) {
      throw new Error(`Khoi tao bucket that bai: ${err.message}`);
    }
  }

  // Tao presigned URL de client upload file truc tiep bang HTTP PUT
  async generatePresignedUploadUrl({ fileName, mimeType, bucket = this.bucket } = {}) {
    if (!fileName || typeof fileName !== 'string' || fileName.trim() === '') {
      throw new Error('Ten file khong duoc de trong');
    }

    // Dam bao bucket da duoc tao
    await this.ensureBucketExists(bucket);

    const fileKey = this._generateFileKey(fileName.trim());
    const safeMimeType = mimeType || 'application/octet-stream';

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: fileKey,
      ContentType: safeMimeType,
    });

    try {
      // Ky presigned URL bang presignerClient de khop voi public endpoint cua client
      const uploadUrl = await getSignedUrl(this.presignerClient, command, {
        expiresIn: this.expiresIn,
      });

      // Link truy cap media sau khi upload xong (dung public endpoint)
      const mediaUrl = `${this.publicEndpoint}/${bucket}/${fileKey}`;

      return {
        uploadUrl,
        mediaUrl,
        fileKey,
        bucket,
        expiresIn: this.expiresIn,
        mimeType: safeMimeType,
      };
    } catch (err) {
      throw new Error(`Tao Pre-signed URL that bai: ${err.message}`);
    }
  }

  // Kiem tra file co ton tai trong bucket khong
  async checkFileExists(fileKey, bucket = this.bucket) {
    try {
      await this.internalClient.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: fileKey,
        })
      );
      return true;
    } catch (err) {
      if (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound') {
        return false;
      }
      throw err;
    }
  }
}

module.exports = StorageService;
