/**
 * Script kiem tra MockStorageService hoat dong
 * Chay: node tests/test-mock-storage.js
 */
const MockStorageService = require('../src/core/services/MockStorageService');

async function runTest() {
  console.log('=== BAT DAU KIEM TRA MOCK STORAGE SERVICE ===\n');

  const storageService = new MockStorageService({
    bucket: 'messenger-media',
    endpoint: 'http://localhost:9000',
    expiresIn: 300,
  });

  let passedTests = 0;
  let totalTests = 0;

  // Test 1: Tao presigned URL thanh cong
  totalTests++;
  try {
    const result = await storageService.generatePresignedUploadUrl({
      fileName: 'avatar-test.png',
      mimeType: 'image/png',
    });

    console.log('[TEST 1] Tao presigned URL hop le:');
    console.log('  - uploadUrl:', result.uploadUrl);
    console.log('  - mediaUrl :', result.mediaUrl);
    console.log('  - fileKey  :', result.fileKey);
    console.log('  - bucket   :', result.bucket);
    console.log('  - expiresIn:', result.expiresIn);
    console.log('  - mimeType :', result.mimeType);

    if (
      result.uploadUrl.includes('messenger-media') &&
      result.mediaUrl.includes('avatar-test.png') &&
      result.expiresIn === 300 &&
      result.mimeType === 'image/png'
    ) {
      console.log('=> TEST 1: THANH CONG\n');
      passedTests++;
    } else {
      console.error('=> TEST 1: THAT BAI (du lieu tra ve khong dung dinh dang)\n');
    }
  } catch (err) {
    console.error('=> TEST 1: THAT BAI voi loi:', err.message, '\n');
  }

  // Test 2: Tinh duy nhat cua fileKey
  totalTests++;
  try {
    const resA = await storageService.generatePresignedUploadUrl({ fileName: 'photo.jpg' });
    const resB = await storageService.generatePresignedUploadUrl({ fileName: 'photo.jpg' });

    console.log('[TEST 2] Kiem tra tinh duy nhat cua fileKey:');
    console.log('  - Key A:', resA.fileKey);
    console.log('  - Key B:', resB.fileKey);

    if (resA.fileKey !== resB.fileKey) {
      console.log('=> TEST 2: THANH CONG (2 key hoan toan khac nhau)\n');
      passedTests++;
    } else {
      console.error('=> TEST 2: THAT BAI (trung lap key)\n');
    }
  } catch (err) {
    console.error('=> TEST 2: THAT BAI voi loi:', err.message, '\n');
  }

  // Test 3: Bat loi khi thieu fileName
  totalTests++;
  try {
    console.log('[TEST 3] Kiem tra validate khi khong truyen fileName:');
    await storageService.generatePresignedUploadUrl({});
    console.error('=> TEST 3: THAT BAI (khong nem loi khi thieu fileName)\n');
  } catch (err) {
    console.log('  - Bat loi thanh cong:', err.message);
    console.log('=> TEST 3: THANH CONG\n');
    passedTests++;
  }

  // Test 4: Kiem tra ham checkBucketExists
  totalTests++;
  try {
    const exists = await storageService.checkBucketExists();
    console.log('[TEST 4] Kiem tra checkBucketExists:', exists);
    if (exists === true) {
      console.log('=> TEST 4: THANH CONG\n');
      passedTests++;
    } else {
      console.error('=> TEST 4: THAT BAI\n');
    }
  } catch (err) {
    console.error('=> TEST 4: THAT BAI voi loi:', err.message, '\n');
  }

  console.log(`=== KET QUA: ${passedTests}/${totalTests} TESTS THANH CONG ===`);
  if (passedTests === totalTests) {
    console.log('MOCKUP STORAGE SERVICE HOAT DONG DUNG GIAO UOC!');
  } else {
    process.exit(1);
  }
}

runTest();

