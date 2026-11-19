const path = require('path');
const {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  PutBucketPolicyCommand,
  DeleteBucketPolicyCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const MAX_FILES_PER_MESSAGE = 4;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB (5,242,880 bytes)
const DEFAULT_UPLOAD_EXPIRES_IN = 300; // 5 phut
const DEFAULT_VIEW_EXPIRES_IN = 3600; // 1 gio
const DEFAULT_ORPHAN_MAX_AGE_MS = 30 * 60 * 1000; // 30 phut

const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.sh', '.bat', '.cmd', '.msi', '.ps1', '.vbs',
  '.jar', '.apk', '.scr', '.com', '.php', '.py', '.js',
  '.dll', '.bin', '.cpl', '.hta', '.pif',
]);

const ALLOWED_MEDIA_TYPES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'video/mp4': ['.mp4'],
  'video/webm': ['.webm'],
  'video/quicktime': ['.mov'],
};

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
    this.accessKeyId = config.accessKeyId || process.env.MINIO_ROOT_USER || '';
    this.secretAccessKey = config.secretAccessKey || process.env.MINIO_ROOT_PASSWORD || '';
    this.bucket = config.bucket || process.env.MINIO_BUCKET || 'messenger-media';
    this.expiresIn = config.expiresIn || DEFAULT_UPLOAD_EXPIRES_IN;
    this.viewExpiresIn = config.viewExpiresIn || DEFAULT_VIEW_EXPIRES_IN;
    this.maxFilesPerMessage = config.maxFilesPerMessage || MAX_FILES_PER_MESSAGE;
    this.maxFileSizeBytes = config.maxFileSizeBytes || MAX_FILE_SIZE_BYTES;
    this.orphanMaxAgeMs = config.orphanMaxAgeMs || DEFAULT_ORPHAN_MAX_AGE_MS;

    // Mac dinh la private bucket (publicRead = false)
    this.publicRead =
      config.publicRead !== undefined
        ? Boolean(config.publicRead)
        : process.env.MINIO_PUBLIC_READ === 'true';

    // Danh sach objectKey dang trong qua trinh gui hoac cho worker xu ly
    this.pendingAttachmentKeys = new Map();

    // Client noi bo: dung cho cac thao tac backend voi MinIO
    this.internalClient = new S3Client({
      endpoint: this.internalEndpoint,
      region: this.region,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      },
      forcePathStyle: true,
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

  // Sinh key duy nhat cho file, gan voi chatBoxId va userId neu co
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

  // Kiem tra dinh dang, phan mo rong va dung luong file theo whitelist anh/video
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

  // Nhan dien MIME type thuc te tu 32 bytes dau tien (Magic Bytes)
  _detectMimeFromMagicBytes(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
      return null;
    }

    // Chan ngay chữ ký file thuc thi MZ (.exe/.dll), ELF, hoac Shebang (#!)
    if (
      (buffer[0] === 0x4d && buffer[1] === 0x5a) ||
      (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) ||
      (buffer[0] === 0x23 && buffer[1] === 0x21)
    ) {
      return null;
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return 'image/png';
    }

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'image/jpeg';
    }

    // GIF: GIF87a hoac GIF89a
    if (buffer.length >= 6) {
      const gifHeader = buffer.subarray(0, 6).toString('ascii');
      if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
        return 'image/gif';
      }
    }

    // WEBP: RIFF....WEBP
    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return 'image/webp';
    }

    // WEBM / Matroska: 1A 45 DF A3
    if (
      buffer[0] === 0x1a &&
      buffer[1] === 0x45 &&
      buffer[2] === 0xdf &&
      buffer[3] === 0xa3
    ) {
      return 'video/webm';
    }

    // MP4 / QuickTime MOV: ISO Base Media File Format (box 'ftyp', 'moov', 'mdat', 'wide')
    if (buffer.length >= 12) {
      const boxType = buffer.subarray(4, 8).toString('ascii');
      if (['ftyp', 'moov', 'mdat', 'wide', 'free'].includes(boxType)) {
        const majorBrand = buffer.subarray(8, 12).toString('ascii');
        if (majorBrand === 'qt  ') {
          return 'video/quicktime';
        }
        return 'video/mp4';
      }
    }

    return null;
  }

  // Kiem traMIME khai bao va MIME thuc te co tuong thich khong
  _isMimeCompatible(declaredMime, detectedMime) {
    if (!detectedMime) return false;
    if (!declaredMime) return true;
    const normDeclared = declaredMime.toLowerCase();
    if (normDeclared === detectedMime) return true;

    // Container MP4 va MOV dung chung cau truc box ftyp
    const mp4MovGroup = new Set(['video/mp4', 'video/quicktime']);
    if (mp4MovGroup.has(normDeclared) && mp4MovGroup.has(detectedMime)) {
      return true;
    }
    return false;
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

  // Tu dong tao bucket neu chua co va ap dung che do Private (hoac Public neu bat)
  async ensureBucketExists(bucketName = this.bucket) {
    try {
      const exists = await this.checkBucketExists(bucketName);
      if (!exists) {
        await this.internalClient.send(new CreateBucketCommand({ Bucket: bucketName }));
        console.log(`[MinIO] Da tao bucket moi: ${bucketName}`);
      }

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
      } else {
        // Go bo public read policy cu de dam bao bucket o che do Private
        try {
          await this.internalClient.send(
            new DeleteBucketPolicyCommand({
              Bucket: bucketName,
            })
          );
        } catch (delPolicyErr) {
          // Bo qua neu bucket chua co policy
        }
      }
      return true;
    } catch (err) {
      throw new Error(`Khoi tao bucket that bai: ${err.message}`);
    }
  }

  // Tao presigned URL cho 1 file (giu tuong thich voi Day 1 & Day 2)
  async generatePresignedUploadUrl({
    fileName,
    mimeType,
    fileSize,
    chatBoxId = null,
    userId = null,
    sortOrder = 0,
    bucket = this.bucket,
  } = {}) {
    if (!fileName || typeof fileName !== 'string' || fileName.trim() === '') {
      throw new Error('Ten file khong duoc de trong');
    }

    const ext = path.extname(fileName.trim()).toLowerCase();
    if (ext && BLOCKED_EXTENSIONS.has(ext)) {
      throw new Error(`Dinh dang file nguy hiem bi chan (${ext})`);
    }

    if (chatBoxId !== null || fileSize !== undefined) {
      const validation = this.validateMediaFile({
        fileName,
        mimeType,
        fileSize,
        requireSize: fileSize !== undefined,
      });
      if (!validation.valid) {
        throw new Error(validation.error);
      }
    }

    await this.ensureBucketExists(bucket);

    const fileKey = this._generateFileKey(fileName.trim(), { chatBoxId, userId, sortOrder });
    const safeMimeType = mimeType || 'application/octet-stream';

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: fileKey,
      ContentType: safeMimeType,
    });

    try {
      const uploadUrl = await getSignedUrl(this.presignerClient, command, {
        expiresIn: this.expiresIn,
      });

      const mediaUrl = `${this.publicEndpoint}/${bucket}/${fileKey}`;

      return {
        uploadUrl,
        mediaUrl,
        fileKey,
        objectKey: fileKey,
        bucket,
        expiresIn: this.expiresIn,
        mimeType: safeMimeType,
      };
    } catch (err) {
      throw new Error(`Tao Pre-signed URL that bai: ${err.message}`);
    }
  }

  // Tao presigned PUT URL cho mang files (toi da 4 file trong 1 tin nhan)
  async generatePresignedUploadUrls({ chatBoxId, userId, files, bucket = this.bucket } = {}) {
    if (!chatBoxId || !userId) {
      throw new Error('Thieu thong tin chatBoxId hoac userId');
    }

    if (!Array.isArray(files) || files.length === 0) {
      throw new Error('Danh sach file khong duoc de trong');
    }

    if (files.length > this.maxFilesPerMessage) {
      throw new Error(`Moi tin nhan chi duoc dinh kem toi da ${this.maxFilesPerMessage} file`);
    }

    await this.ensureBucketExists(bucket);

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

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        ContentType: validation.mimeType,
      });

      const uploadUrl = await getSignedUrl(this.presignerClient, command, {
        expiresIn: this.expiresIn,
      });

      results.push({
        valid: true,
        sortOrder,
        objectKey,
        fileKey: objectKey,
        fileName: validation.fileName,
        mimeType: validation.mimeType,
        fileSize: validation.fileSize,
        uploadUrl,
        bucket,
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

  // Tao Pre-signed GET URL de xem anh/video trong bucket Private (mac dinh 3600s = 1 gio)
  async generatePresignedViewUrl(objectKey, { expiresIn = this.viewExpiresIn, bucket = this.bucket } = {}) {
    if (!objectKey || typeof objectKey !== 'string' || objectKey.trim() === '') {
      throw new Error('objectKey khong duoc de trong');
    }

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey.trim(),
    });

    const viewUrl = await getSignedUrl(this.presignerClient, command, {
      expiresIn,
    });

    return {
      objectKey: objectKey.trim(),
      viewUrl,
      expiresIn,
    };
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

  // Doc n bytes dau tien cua object de kiem tra Magic Bytes ma khong tai toan bo file
  async _readObjectHeaderBytes(objectKey, byteCount = 32, bucket = this.bucket) {
    const response = await this.internalClient.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Range: `bytes=0-${byteCount - 1}`,
      })
    );

    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  // Xac minh object sau khi upload: ton tai, dung quyen, <= 5MB va dung Magic Bytes anh/video
  async verifyUploadedObject(
    objectKey,
    {
      expectedChatBoxId = null,
      expectedUserId = null,
      declaredMimeType = null,
      bucket = this.bucket,
    } = {}
  ) {
    if (!objectKey || typeof objectKey !== 'string') {
      return { valid: false, error: 'objectKey khong hop le' };
    }

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

    let headData;
    try {
      headData = await this.internalClient.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: objectKey,
        })
      );
    } catch (err) {
      if (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound') {
        return { valid: false, error: 'File chua duoc upload len MinIO hoac khong ton tai' };
      }
      return { valid: false, error: `Loi kiem tra file tren MinIO: ${err.message}` };
    }

    const actualSize = Number(headData.ContentLength || 0);
    if (actualSize <= 0) {
      await this.deleteObject(objectKey, bucket).catch(() => {});
      return { valid: false, error: 'File rong (0 bytes)' };
    }

    if (actualSize > this.maxFileSizeBytes) {
      await this.deleteObject(objectKey, bucket).catch(() => {});
      return {
        valid: false,
        error: `Dung luong file thuc te (${actualSize} bytes) vuot qua gioi han 5 MB`,
      };
    }

    // Doc 32 bytes dau tien de kiem tra chu ky file thuc te
    try {
      const headerBuffer = await this._readObjectHeaderBytes(objectKey, 32, bucket);
      const detectedMime = this._detectMimeFromMagicBytes(headerBuffer);

      if (!detectedMime) {
        await this.deleteObject(objectKey, bucket).catch(() => {});
        return {
          valid: false,
          error: 'Noi dung file thuc te khong phai hinh anh hoac video hop le',
        };
      }

      if (declaredMimeType && !this._isMimeCompatible(declaredMimeType, detectedMime)) {
        await this.deleteObject(objectKey, bucket).catch(() => {});
        return {
          valid: false,
          error: `Dinh dang thuc te (${detectedMime}) khong khop voi khai bao (${declaredMimeType})`,
        };
      }

      return {
        valid: true,
        objectKey,
        fileName: parsed.isValidChatKey ? parsed.fileName : path.basename(objectKey),
        mimeType: detectedMime,
        fileSize: actualSize,
        sortOrder: parsed.isValidChatKey ? parsed.sortOrder : 0,
      };
    } catch (err) {
      return { valid: false, error: `Khong the xac minh chu ky file: ${err.message}` };
    }
  }

  // Danh dau cac objectKey dang cho xu ly (bao ve khoi cleanup khi dang gui hoac trong Queue)
  markKeysAsPending(objectKeys = []) {
    const now = Date.now();
    for (const key of objectKeys) {
      if (key) {
        this.pendingAttachmentKeys.set(key, now);
      }
    }
  }

  // Go danh dau sau khi da luu DB hoac xu ly xong
  unmarkPendingKeys(objectKeys = []) {
    for (const key of objectKeys) {
      this.pendingAttachmentKeys.delete(key);
    }
  }

  // Kiem tra key co dang o trang thai cho xu ly khong (tu het han khoa sau 30 phut)
  isKeyPending(objectKey) {
    if (!this.pendingAttachmentKeys.has(objectKey)) {
      return false;
    }
    const lockedAt = this.pendingAttachmentKeys.get(objectKey);
    if (Date.now() - lockedAt > this.orphanMaxAgeMs) {
      this.pendingAttachmentKeys.delete(objectKey);
      return false;
    }
    return true;
  }

  // Xoa 1 object khoi bucket
  async deleteObject(objectKey, bucket = this.bucket) {
    if (!objectKey) return false;
    await this.internalClient.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: objectKey,
      })
    );
    return true;
  }

  // Xoa nhieu object khoi bucket
  async deleteObjects(objectKeys = [], bucket = this.bucket) {
    const validKeys = objectKeys.filter((k) => typeof k === 'string' && k.trim() !== '');
    if (validKeys.length === 0) return [];

    await this.internalClient.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: validKeys.map((Key) => ({ Key })),
          Quiet: true,
        },
      })
    );
    return validKeys;
  }

  // Liet ke cac object trong bucket theo prefix
  async listObjects(prefix = 'chats/', bucket = this.bucket) {
    const response = await this.internalClient.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
      })
    );
    return (response.Contents || []).map((item) => ({
      objectKey: item.Key,
      size: item.Size,
      lastModified: item.LastModified,
    }));
  }
}

module.exports = StorageService;
module.exports.MAX_FILES_PER_MESSAGE = MAX_FILES_PER_MESSAGE;
module.exports.MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_BYTES;
module.exports.ALLOWED_MEDIA_TYPES = ALLOWED_MEDIA_TYPES;
module.exports.BLOCKED_EXTENSIONS = BLOCKED_EXTENSIONS;
