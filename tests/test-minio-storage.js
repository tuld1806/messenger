/**
 * Script kiem thu StorageService nang cao voi MinIO
 * Bao gom: Upload anh binary, kiem tra het han URL, restart container
 * Chay: node tests/test-minio-storage.js
 */
require('dotenv').config();
const { execSync } = require('child_process');
const StorageService = require('../src/core/services/StorageService');

// Buffer binary cua 1 file anh PNG 1x1 pixel chuan
const SAMPLE_PNG_BUFFER = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d420000000049454e44ae426082',
  'hex'
);

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAdvancedMinIOTest() {
  console.log('=== BAT DAU KIEM THU MINIO & STORAGE SERVICE (BO SUNG) ===\n');

  const storageService = new StorageService({
    internalEndpoint: process.env.MINIO_INTERNAL_ENDPOINT || 'http://127.0.0.1:9000',
    publicEndpoint: process.env.MINIO_PUBLIC_ENDPOINT || 'http://127.0.0.1:9000',
    region: process.env.MINIO_REGION || 'us-east-1',
    accessKeyId: process.env.MINIO_ROOT_USER,
    secretAccessKey: process.env.MINIO_ROOT_PASSWORD,
    bucket: process.env.MINIO_BUCKET || 'messenger-media',
    expiresIn: 300,
    publicRead: process.env.MINIO_PUBLIC_READ === 'true',
  });

  let passedTests = 0;
  let totalTests = 0;
  let uploadedImageFileKey = null;
  let uploadedImageMediaUrl = null;

  // TEST 1: Kiem tra ket noi & Khoi tao Bucket
  totalTests++;
  try {
    console.log('[TEST 1] Kiem tra ket noi va tao bucket:');
    await storageService.ensureBucketExists();
    const exists = await storageService.checkBucketExists();
    if (exists) {
      console.log(`  - Bucket '${storageService.bucket}' da san sang.`);
      console.log('=> TEST 1: THANH CONG\n');
      passedTests++;
    } else {
      console.error('=> TEST 1: THAT BAI\n');
    }
  } catch (err) {
    console.error('=> TEST 1: THAT BAI voi loi:', err.message, '\n');
    process.exit(1);
  }

  // TEST 2: Upload anh PNG binary thuc te qua Pre-signed URL
  totalTests++;
  try {
    console.log('[TEST 2] Sinh Pre-signed URL va upload anh PNG binary thuc te:');
    const presigned = await storageService.generatePresignedUploadUrl({
      fileName: 'chat-avatar-test.png',
      mimeType: 'image/png',
    });

    uploadedImageFileKey = presigned.fileKey;
    uploadedImageMediaUrl = presigned.mediaUrl;

    console.log('  - fileKey  :', presigned.fileKey);
    console.log('  - uploadUrl:', presigned.uploadUrl);

    // Upload Buffer anh binary qua HTTP PUT
    const uploadRes = await fetch(presigned.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/png',
      },
      body: SAMPLE_PNG_BUFFER,
    });

    console.log(`  - Upload HTTP Status: ${uploadRes.status} ${uploadRes.statusText}`);

    // Xac nhan file ton tai trong MinIO bucket
    const exists = await storageService.checkFileExists(presigned.fileKey);
    console.log(`  - File ton tai tren MinIO: ${exists}`);

    // Tai lai file qua Pre-signed GET URL va so sanh binary voi file goc
    const { viewUrl } = await storageService.generatePresignedViewUrl(presigned.fileKey);
    const downloadRes = await fetch(viewUrl);
    const downloadedArrayBuffer = await downloadRes.arrayBuffer();
    const downloadedBuffer = Buffer.from(downloadedArrayBuffer);

    const isMatch = Buffer.compare(SAMPLE_PNG_BUFFER, downloadedBuffer) === 0;
    console.log(`  - So sanh du lieu binary goc va tai ve: ${isMatch ? 'TRUNG KHOP 100%' : 'SAI LECH'}`);
    console.log(`  - Kich thuoc anh: ${downloadedBuffer.length} bytes`);

    if (uploadRes.status === 200 && exists && isMatch) {
      console.log('=> TEST 2: THANH CONG (Upload va download anh binary chinh xac 100%)\n');
      passedTests++;
    } else {
      console.error('=> TEST 2: THAT BAI (Upload anh binary khong thanh cong)\n');
    }
  } catch (err) {
    console.error('=> TEST 2: THAT BAI voi loi:', err.message, '\n');
  }

  // TEST 3: Kiem tra URL co thoi han 300 giay
  totalTests++;
  try {
    console.log('[TEST 3] Kiem tra thoi han Pre-signed URL la 300 giay (5 phut):');
    const res = await storageService.generatePresignedUploadUrl({
      fileName: 'expiry-check.jpg',
      mimeType: 'image/jpeg',
    });

    const hasExpires300 = res.expiresIn === 300;
    const urlContainsExpires300 = res.uploadUrl.includes('X-Amz-Expires=300');

    console.log(`  - expiresIn property: ${res.expiresIn}`);
    console.log(`  - URL chua X-Amz-Expires=300: ${urlContainsExpires300}`);

    if (hasExpires300 && urlContainsExpires300) {
      console.log('=> TEST 3: THANH CONG (Thoi han duoc thiet lap dung 300 giay)\n');
      passedTests++;
    } else {
      console.error('=> TEST 3: THAT BAI (Sai thoi han URL)\n');
    }
  } catch (err) {
    console.error('=> TEST 3: THAT BAI voi loi:', err.message, '\n');
  }

  // TEST 4: Kiem tra URL bi tu choi sau khi het han (Expiry rejection test)
  totalTests++;
  try {
    console.log('[TEST 4] Kiem tra Pre-signed URL bi tu choi sau khi het han:');
    // Tao storage service rieng co thoi han 1 giay de test
    const shortLivedStorageService = new StorageService({
      internalEndpoint: storageService.internalEndpoint,
      publicEndpoint: storageService.publicEndpoint,
      region: storageService.region,
      accessKeyId: storageService.accessKeyId,
      secretAccessKey: storageService.secretAccessKey,
      bucket: storageService.bucket,
      expiresIn: 1, // 1 giay
    });

    const expiredPresigned = await shortLivedStorageService.generatePresignedUploadUrl({
      fileName: 'expired-test.png',
      mimeType: 'image/png',
    });

    console.log('  - Da tao URL co thoi han 1 giay, cho 2.5 giay de het han...');
    await sleep(2500);

    // Thu upload khi da qua 2.5 giay
    const expiredUploadRes = await fetch(expiredPresigned.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/png',
      },
      body: SAMPLE_PNG_BUFFER,
    });

    const resBody = await expiredUploadRes.text();
    console.log(`  - HTTP Status khi het han: ${expiredUploadRes.status} (ky vong: 403 Forbidden)`);
    console.log(`  - MinIO Error Body: ${resBody.substring(0, 120)}...`);

    if (expiredUploadRes.status === 403 && (resBody.includes('Request has expired') || resBody.includes('AccessDenied') || resBody.includes('ExpiredToken'))) {
      console.log('=> TEST 4: THANH CONG (MinIO tu choi yeu cau sau khi URL het han voi HTTP 403)\n');
      passedTests++;
    } else {
      console.error('=> TEST 4: THAT BAI (MinIO khong tu choi URL het han)\n');
    }
  } catch (err) {
    console.error('=> TEST 4: THAT BAI voi loi:', err.message, '\n');
  }

  // TEST 5: Restart MinIO container va kiem tra file cu van ton tai
  totalTests++;
  try {
    console.log('[TEST 5] Restart container MinIO va kiem tra tinh ben vung cua file:');
    console.log('  - Dang restart container messenger-minio...');
    execSync('docker restart messenger-minio', { stdio: 'pipe' });
    console.log('  - Container da restart, doi 3 giay de MinIO khoi dong lai...');
    await sleep(3000);

    // Kiem tra file anh upload o Test 2 co con ton tai khong
    const stillExists = await storageService.checkFileExists(uploadedImageFileKey);
    console.log(`  - Kiem tra file '${uploadedImageFileKey}' sau khi restart: ${stillExists ? 'VAN TON TAI' : 'DA MAT'}`);

    // Doc lai noi dung file qua Pre-signed GET URL
    const { viewUrl: restartViewUrl } = await storageService.generatePresignedViewUrl(uploadedImageFileKey);
    const verifyDownloadRes = await fetch(restartViewUrl);
    const verifyBuffer = Buffer.from(await verifyDownloadRes.arrayBuffer());
    const isIntegrityPreserved = Buffer.compare(SAMPLE_PNG_BUFFER, verifyBuffer) === 0;

    console.log(`  - Toan ven du lieu sau restart: ${isIntegrityPreserved ? 'CHINH XAC 100%' : 'BI SAI LECH'}`);

    if (stillExists && isIntegrityPreserved) {
      console.log('=> TEST 5: THANH CONG (Volume ben vung, du lieu khong bi mat khi restart)\n');
      passedTests++;
    } else {
      console.error('=> TEST 5: THAT BAI (Mat du lieu sau khi restart container)\n');
    }
  } catch (err) {
    console.error('=> TEST 5: THAT BAI voi loi:', err.message, '\n');
  }

  console.log(`=== KET QUA TONG KET: ${passedTests}/${totalTests} TESTS THANH CONG ===`);
  if (passedTests === totalTests) {
    console.log('TAT CA CAC KIEM THU BO SUNG DEU DAT 100%!');
  } else {
    process.exit(1);
  }
}

runAdvancedMinIOTest();
