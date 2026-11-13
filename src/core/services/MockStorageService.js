/**
 * Mockup Storage Service
 * Dung de gia lap tao presigned URL cho frontend test giao dien truoc
 * Se duoc thay the bang StorageService that o Giai doan 2
 */
class MockStorageService {
  constructor(config = {}) {
    this.bucket = config.bucket || process.env.MINIO_BUCKET || 'messenger-media';
    this.endpoint = config.endpoint || process.env.MINIO_ENDPOINT || 'http://localhost:9000';
    this.expiresIn = config.expiresIn || 300; // thoi han 5 phut (300 giay)
  }

  // Sinh key duy nhat de tranh trung ten file trong bucket
  _generateFileKey(fileName) {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const cleanName = fileName
      ? fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
      : 'file';
    return `${timestamp}-${randomStr}-${cleanName}`;
  }

  // Tao presigned url gia lap
  async generatePresignedUploadUrl({ fileName, mimeType } = {}) {
    if (!fileName || typeof fileName !== 'string' || fileName.trim() === '') {
      throw new Error('Ten file khong duoc de trong');
    }

    const fileKey = this._generateFileKey(fileName.trim());
    const safeMimeType = mimeType || 'application/octet-stream';

    // Link upload gia lap theo chuan S3 PUT
    const uploadUrl = `${this.endpoint}/${this.bucket}/${fileKey}?mock_signature=test_valid&expires=${this.expiresIn}`;

    // Link truy cap file sau khi upload hoan tat
    const mediaUrl = `${this.endpoint}/${this.bucket}/${fileKey}`;

    return {
      uploadUrl,
      mediaUrl,
      fileKey,
      bucket: this.bucket,
      expiresIn: this.expiresIn,
      mimeType: safeMimeType,
    };
  }

  // Kiem tra bucket ton tai (gia lap luon tra ve true)
  async checkBucketExists() {
    return true;
  }
}

module.exports = MockStorageService;

