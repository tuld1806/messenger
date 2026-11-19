const path = require('path');
const {
  MAX_FILES_PER_MESSAGE,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_MEDIA_TYPES,
  BLOCKED_EXTENSIONS,
} = require('./StorageService');

/**
 * Mockup Storage Service
 * Dung de gia lap tao presigned URL va luu tru media tren RAM
 */
class MockStorageService {
  constructor(config = {}) {
    this.bucket = config.bucket || process.env.MINIO_BUCKET || 'messenger-media';
    this.endpoint = config.endpoint || process.env.MINIO_ENDPOINT || 'http://localhost:9000';
    this.publicEndpoint = config.publicEndpoint || this.endpoint;
    this.expiresIn = config.expiresIn || 300; // thoi han 5 phut (300 giay)
    this.viewExpiresIn = config.viewExpiresIn || 3600; // thoi han 1 gio (3600 giay)
    this.maxFilesPerMessage = config.maxFilesPerMessage || MAX_FILES_PER_MESSAGE;
    this.maxFileSizeBytes = config.maxFileSizeBytes || MAX_FILE_SIZE_BYTES;
    this.orphanMaxAgeMs = config.orphanMaxAgeMs || 30 * 60 * 1000;
    this.publicRead = false;

    this.mockObjects = new Map();
    this.pendingAttachmentKeys = new Map();
  }

  // Sinh key duy nhat de tranh trung ten file trong bucket
  _generateFileKey(fileName, { chatBoxId = null, userId = null, sortOrder = 0 } = {}) {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const cleanName = fileName
      ? fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
      : 'file';

    if (chatBoxId !== null && chatBoxId !== undefined && userId !== null && userId !== undefined) {
      const cId = parseInt(chatBoxId, 10);
      const uId = parseInt(userId, 10);
      const order = parseInt(sortOrder, 10) || 0;
      return `chats/${cId}/u_${uId}/${timestamp}-${order}-${randomStr}-${cleanName}`;
    }

    return `${timestamp}-${randomStr}-${cleanName}`;
  }

  // Phan tich objectKey de lay thong tin chatBoxId, userId, timestamp, sortOrder
  parseObjectKey(objectKey) {
    if (!objectKey || typeof objectKey !== 'string') {
      return { isValidChatKey: false };
    }

    const match = objectKey.match(/^chats\/(\d+)\/u_(\d+)\/(\d+)-(\d+)-([a-z0-9]+)-(.+)$/);
    if (!match) {
      return { isValidChatKey: false };
    }

    return {
      isValidChatKey: true,
      chatBoxId: parseInt(match[1], 10),
      userId: parseInt(match[2], 10),
      timestamp: parseInt(match[3], 10),
      sortOrder: parseInt(match[4], 10),
      randomToken: match[5],
      fileName: match[6],
    };
  }

  // Validate file anh/video theo whitelist va gioi han 5MB
  validateMediaFile({ fileName, mimeType, fileSize, requireSize = true } = {}) {
    if (!fileName || typeof fileName !== 'string' || fileName.trim() === '') {
      return { valid: false, error: 'Ten file khong duoc de trong' };
    }

    const cleanFileName = fileName.trim();
    const ext = path.extname(cleanFileName).toLowerCase();

    if (!ext) {
      return { valid: false, error: 'File phai co phan mo rong hop le' };
    }

    if (BLOCKED_EXTENSIONS.has(ext)) {
      return { valid: false, error: `Dinh dang file nguy hiem bi chan (${ext})` };
    }

    const normalizedMime = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
    const allowedExts = ALLOWED_MEDIA_TYPES[normalizedMime];

    if (!allowedExts || !allowedExts.includes(ext)) {
      return {
        valid: false,
        error: 'Chi ho tro file hinh anh (JPG, PNG, GIF, WEBP) va video (MP4, WEBM, MOV)',
      };
    }

    if (requireSize || (fileSize !== undefined && fileSize !== null)) {
      const parsedSize = Number(fileSize);
      if (!Number.isFinite(parsedSize) || parsedSize <= 0) {
        return { valid: false, error: 'Dung luong file khong hop le' };
      }
      if (parsedSize > this.maxFileSizeBytes) {
        return {
          valid: false,
          error: `Dung luong file vuot qua gioi han toi da 5 MB (${this.maxFileSizeBytes} bytes)`,
        };
      }
      return {
        valid: true,
        fileName: cleanFileName,
        mimeType: normalizedMime,
        fileSize: Math.floor(parsedSize),
        extension: ext,
      };
    }

    return {
      valid: true,
      fileName: cleanFileName,
      mimeType: normalizedMime,
      fileSize: 0,
      extension: ext,
    };
  }

  // Tao presigned url gia lap cho 1 file
  async generatePresignedUploadUrl({
    fileName,
    mimeType,
    fileSize,
    chatBoxId = null,
    userId = null,
    sortOrder = 0,
  } = {}) {
    if (!fileName || typeof fileName !== 'string' || fileName.trim() === '') {
      throw new Error('Ten file khong duoc de trong');
    }

    const ext = path.extname(fileName.trim()).toLowerCase();
    if (ext && BLOCKED_EXTENSIONS.has(ext)) {
      throw new Error(`Dinh dang file nguy hiem bi chan (${ext})`);
    }

    const fileKey = this._generateFileKey(fileName.trim(), { chatBoxId, userId, sortOrder });
    const safeMimeType = mimeType || 'application/octet-stream';

    // Link upload gia lap theo chuan S3 PUT
    const uploadUrl = `${this.endpoint}/${this.bucket}/${fileKey}?mock_signature=test_valid&expires=${this.expiresIn}`;

    // Link truy cap file sau khi upload hoan tat
    const mediaUrl = `${this.endpoint}/${this.bucket}/${fileKey}`;

    return {
      uploadUrl,
      mediaUrl,
      fileKey,
      objectKey: fileKey,
      bucket: this.bucket,
      expiresIn: this.expiresIn,
      mimeType: safeMimeType,
    };
  }

  // Tao presigned PUT URL gia lap cho mang files (1..4 files)
  async generatePresignedUploadUrls({ chatBoxId, userId, files } = {}) {
    if (!chatBoxId || !userId) {
      throw new Error('Thieu thong tin chatBoxId hoac userId');
    }

    if (!Array.isArray(files) || files.length === 0) {
      throw new Error('Danh sach file khong duoc de trong');
    }

    if (files.length > this.maxFilesPerMessage) {
      throw new Error(`Moi tin nhan chi duoc dinh kem toi da ${this.maxFilesPerMessage} file`);
    }

    const results = [];
    for (let idx = 0; idx < files.length; idx++) {
      const item = files[idx] || {};
      const sortOrder =
        item.sortOrder !== undefined && Number.isInteger(Number(item.sortOrder))
          ? Number(item.sortOrder)
          : idx;

      const validation = this.validateMediaFile({
        fileName: item.fileName,
        mimeType: item.mimeType,
        fileSize: item.fileSize,
        requireSize: true,
      });

      if (!validation.valid) {
        results.push({
          valid: false,
          sortOrder,
          fileName: item.fileName || '',
          mimeType: item.mimeType || '',
          fileSize: Number(item.fileSize) || 0,
          error: validation.error,
        });
        continue;
      }

      const objectKey = this._generateFileKey(validation.fileName, {
        chatBoxId,
        userId,
        sortOrder,
      });

      const uploadUrl = `${this.endpoint}/${this.bucket}/${objectKey}?mock_signature=test_valid&expires=${this.expiresIn}`;

      results.push({
        valid: true,
        sortOrder,
        objectKey,
        fileKey: objectKey,
        fileName: validation.fileName,
        mimeType: validation.mimeType,
        fileSize: validation.fileSize,
        uploadUrl,
        bucket: this.bucket,
        expiresIn: this.expiresIn,
      });
    }

    const validCount = results.filter((r) => r.valid).length;
    const invalidCount = results.length - validCount;

    return {
      chatBoxId: parseInt(chatBoxId, 10),
      files: results,
      validCount,
      invalidCount,
    };
  }

  // Tao Pre-signed GET URL gia lap
  async generatePresignedViewUrl(objectKey, { expiresIn = this.viewExpiresIn } = {}) {
    if (!objectKey || typeof objectKey !== 'string' || objectKey.trim() === '') {
      throw new Error('objectKey khong duoc de trong');
    }
    const cleanKey = objectKey.trim();
    return {
      objectKey: cleanKey,
      viewUrl: `${this.endpoint}/${this.bucket}/${cleanKey}?mock_view_sig=valid&expires=${expiresIn}`,
      expiresIn,
    };
  }

  // Gia lap dua object len storage (phuc vu test)
  putMockObject(objectKey, { size = 1024, mimeType = 'image/png', buffer = null, lastModified = new Date() } = {}) {
    this.mockObjects.set(objectKey, {
      objectKey,
      size,
      mimeType,
      buffer,
      lastModified,
    });
  }

  // Kiem tra bucket ton tai (gia lap luon tra ve true)
  async checkBucketExists() {
    return true;
  }

  async ensureBucketExists() {
    return true;
  }

  async checkFileExists(fileKey) {
    return this.mockObjects.has(fileKey);
  }

  async verifyUploadedObject(
    objectKey,
    { expectedChatBoxId = null, expectedUserId = null, declaredMimeType = null } = {}
  ) {
    const parsed = this.parseObjectKey(objectKey);
    if (expectedChatBoxId !== null && expectedChatBoxId !== undefined) {
      if (!parsed.isValidChatKey || parsed.chatBoxId !== parseInt(expectedChatBoxId, 10)) {
        return { valid: false, error: 'File khong thuoc cuoc tro chuyen nay' };
      }
    }
    if (expectedUserId !== null && expectedUserId !== undefined) {
      if (!parsed.isValidChatKey || parsed.userId !== parseInt(expectedUserId, 10)) {
        return { valid: false, error: 'Ban khong phai nguoi tai len file nay' };
      }
    }

    const obj = this.mockObjects.get(objectKey);
    if (!obj) {
      return { valid: false, error: 'File chua duoc upload len MinIO hoac khong ton tai' };
    }

    if (obj.size <= 0 || obj.size > this.maxFileSizeBytes) {
      this.mockObjects.delete(objectKey);
      return { valid: false, error: 'Dung luong file thuc te vuot qua gioi han 5 MB' };
    }

    if (!ALLOWED_MEDIA_TYPES[obj.mimeType]) {
      this.mockObjects.delete(objectKey);
      return { valid: false, error: 'Noi dung file thuc te khong phai hinh anh hoac video hop le' };
    }

    if (declaredMimeType && declaredMimeType.toLowerCase() !== obj.mimeType.toLowerCase()) {
      this.mockObjects.delete(objectKey);
      return { valid: false, error: 'Dinh dang thuc te khong khop voi khai bao' };
    }

    return {
      valid: true,
      objectKey,
      fileName: parsed.isValidChatKey ? parsed.fileName : path.basename(objectKey),
      mimeType: obj.mimeType,
      fileSize: obj.size,
      sortOrder: parsed.isValidChatKey ? parsed.sortOrder : 0,
    };
  }

  markKeysAsPending(objectKeys = []) {
    const now = Date.now();
    for (const key of objectKeys) {
      if (key) this.pendingAttachmentKeys.set(key, now);
    }
  }

  unmarkPendingKeys(objectKeys = []) {
    for (const key of objectKeys) {
      this.pendingAttachmentKeys.delete(key);
    }
  }

  isKeyPending(objectKey) {
    if (!this.pendingAttachmentKeys.has(objectKey)) return false;
    const lockedAt = this.pendingAttachmentKeys.get(objectKey);
    if (Date.now() - lockedAt > this.orphanMaxAgeMs) {
      this.pendingAttachmentKeys.delete(objectKey);
      return false;
    }
    return true;
  }

  async deleteObject(objectKey) {
    return this.mockObjects.delete(objectKey);
  }

  async deleteObjects(objectKeys = []) {
    const deleted = [];
    for (const key of objectKeys) {
      if (this.mockObjects.delete(key)) {
        deleted.push(key);
      }
    }
    return deleted;
  }

  async listObjects(prefix = 'chats/') {
    const items = [];
    for (const [key, val] of this.mockObjects.entries()) {
      if (key.startsWith(prefix)) {
        items.push({
          objectKey: key,
          size: val.size,
          lastModified: val.lastModified,
        });
      }
    }
    return items;
  }
}

module.exports = MockStorageService;
