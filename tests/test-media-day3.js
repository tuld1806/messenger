/**
 * Kich ban kiem thu toan dien Day 3 - Media Upload, Security, Cleanup & DB Transaction
 * Chay: node tests/test-media-day3.js
 */
require('dotenv').config();
const request = require('supertest');
const createApp = require('../src/app');
const prisma = require('../src/config/prisma');
const MessageRepository = require('../src/core/repositories/MessageRepository');

// Buffer anh PNG 1x1 hop le (Magic bytes: 89 50 4E 47 0D 0A 1A 0A)
const VALID_PNG_BUFFER = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d420000000049454e44ae426082',
  'hex'
);

// Buffer anh JPEG hop le (Magic bytes: FF D8 FF E0 ...)
const VALID_JPEG_BUFFER = Buffer.from(
  'ffd8ffe000104a46494600010101004800480000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffd9',
  'hex'
);

// Buffer video MP4 hop le (ISO BMFF ftyp box: 00 00 00 18 66 74 79 70 69 73 6F 6D ...)
const VALID_MP4_BUFFER = Buffer.from(
  '000000186674797069736f6d0000020069736f6d69736f326d703431000000086d646174',
  'hex'
);

// Buffer gia mao file .exe (Magic bytes MZ: 4D 5A) doi ten thanh .png
const FAKE_EXE_AS_PNG_BUFFER = Buffer.from('4d5a90000300000004000000ffff0000b8000000', 'hex');

async function ensureTestUser(app, username, name) {
  const password = 'password123';
  let res = await request(app)
    .post('/api/auth/login')
    .send({ username, password });

  if (res.status !== 200) {
    res = await request(app)
      .post('/api/auth/register')
      .send({ username, password, name });
  }

  if (!res.body?.data?.token) {
    throw new Error(`Khong the khoi tao user test ${username}: ${JSON.stringify(res.body)}`);
  }

  return {
    user: res.body.data.user,
    token: res.body.data.token,
  };
}

async function runDay3Tests() {
  console.log('=== BAT DAU KIEM THU TOAN DIEN DAY 3 (16 KICH BAN BAT BUOC) ===\n');

  const { app, messageService, storageService } = createApp();
  let passed = 0;
  let total = 0;

  function recordResult(testNum, title, ok, detail = '') {
    total++;
    if (ok) {
      passed++;
      console.log(`[PASS] Test ${testNum}: ${title}${detail ? ' -> ' + detail : ''}`);
    } else {
      console.error(`[FAIL] Test ${testNum}: ${title}${detail ? ' -> ' + detail : ''}`);
    }
  }

  try {
    // Chuan bi 3 users va 2 chatBox
    const u1 = await ensureTestUser(app, 'day3_alice', 'Alice Day3');
    const u2 = await ensureTestUser(app, 'day3_bob', 'Bob Day3');
    const u3 = await ensureTestUser(app, 'day3_mallory', 'Mallory Outsider');

    const chatBoxRes = await request(app)
      .post('/api/messages/chatbox')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ recipientId: u2.user.id });

    const chatBoxId = chatBoxRes.body.data.id;

    const otherChatBoxRes = await request(app)
      .post('/api/messages/chatbox')
      .set('Authorization', `Bearer ${u2.token}`)
      .send({ recipientId: u3.user.id });
    const otherChatBoxId = otherChatBoxRes.body.data.id;

    // ----------------------------------------------------------------
    // Test 1: Nguoi dung co quyen xin Pre-signed URL
    // ----------------------------------------------------------------
    const t1Res = await request(app)
      .post('/api/media/presigned-url')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        files: [{ fileName: 'valid-photo.png', mimeType: 'image/png', fileSize: 1024 }],
      });

    recordResult(
      1,
      'Nguoi dung thuoc ChatBox xin Pre-signed URL thanh cong',
      t1Res.status === 200 && t1Res.body.success === true && t1Res.body.data.validCount === 1,
      `HTTP ${t1Res.status}`
    );

    // ----------------------------------------------------------------
    // Test 2: Nguoi khong thuoc ChatBox bi tu choi
    // ----------------------------------------------------------------
    const t2Res = await request(app)
      .post('/api/media/presigned-url')
      .set('Authorization', `Bearer ${u3.token}`)
      .send({
        chatBoxId,
        files: [{ fileName: 'intruder.png', mimeType: 'image/png', fileSize: 1024 }],
      });

    recordResult(
      2,
      'Nguoi khong thuoc ChatBox bi tu choi (403 Forbidden)',
      t2Res.status === 403 && t2Res.body.success === false,
      `HTTP ${t2Res.status} - ${t2Res.body.message}`
    );

    // ----------------------------------------------------------------
    // Test 3: File hop le duoc cap URL co han 300 giay
    // ----------------------------------------------------------------
    const file1Info = t1Res.body.data.files[0];
    recordResult(
      3,
      'File hop le duoc cap Pre-signed PUT URL (expiresIn = 300s)',
      file1Info.valid === true &&
        file1Info.expiresIn === 300 &&
        file1Info.uploadUrl.includes('X-Amz-Expires=300') &&
        file1Info.objectKey.startsWith(`chats/${chatBoxId}/u_${u1.user.id}/`),
      `objectKey=${file1Info.objectKey}`
    );

    // ----------------------------------------------------------------
    // Test 4: File vuot 5 MB bi tu choi
    // ----------------------------------------------------------------
    const t4Res = await request(app)
      .post('/api/media/presigned-url')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        files: [{ fileName: 'oversize.mp4', mimeType: 'video/mp4', fileSize: 5 * 1024 * 1024 + 1 }],
      });

    recordResult(
      4,
      'File vuot 5 MB bi tu choi',
      t4Res.status === 400 && t4Res.body.success === false,
      `HTTP ${t4Res.status} - ${t4Res.body.message}`
    );

    // ----------------------------------------------------------------
    // Test 5: File khong thuoc whitelist (.exe, .sh, .bat, .pdf) bi tu choi
    // ----------------------------------------------------------------
    const t5Res = await request(app)
      .post('/api/media/presigned-url')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        files: [
          { fileName: 'malware.exe', mimeType: 'application/octet-stream', fileSize: 1024 },
          { fileName: 'script.sh', mimeType: 'text/x-sh', fileSize: 512 },
          { fileName: 'autorun.bat', mimeType: 'application/x-bat', fileSize: 512 },
          { fileName: 'doc.pdf', mimeType: 'application/pdf', fileSize: 2048 },
        ],
      });

    recordResult(
      5,
      'File nguy hiem (.exe, .sh, .bat) va khong thuoc whitelist (.pdf) bi tu choi',
      t5Res.status === 400 &&
        t5Res.body.success === false &&
        t5Res.body.data.invalidCount === 4,
      `invalidCount=${t5Res.body.data?.invalidCount}`
    );

    // ----------------------------------------------------------------
    // Test 6: Request co hon 4 file bi tu choi
    // ----------------------------------------------------------------
    const t6Res = await request(app)
      .post('/api/media/presigned-url')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        files: [
          { fileName: '1.png', mimeType: 'image/png', fileSize: 100 },
          { fileName: '2.png', mimeType: 'image/png', fileSize: 100 },
          { fileName: '3.png', mimeType: 'image/png', fileSize: 100 },
          { fileName: '4.png', mimeType: 'image/png', fileSize: 100 },
          { fileName: '5.png', mimeType: 'image/png', fileSize: 100 },
        ],
      });

    recordResult(
      6,
      'Request co hon 4 file bi tu choi',
      t6Res.status === 400 && t6Res.body.success === false,
      `HTTP ${t6Res.status} - ${t6Res.body.message}`
    );

    // ----------------------------------------------------------------
    // Test 7: Upload thanh cong len MinIO va Backend xac minh duoc object
    // ----------------------------------------------------------------
    const putRes1 = await fetch(file1Info.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: VALID_PNG_BUFFER,
    });

    const verified1 = await storageService.verifyUploadedObject(file1Info.objectKey, {
      expectedChatBoxId: chatBoxId,
      expectedUserId: u1.user.id,
      declaredMimeType: 'image/png',
    });

    recordResult(
      7,
      'Upload truc tiep len MinIO thanh cong va Backend verifyUploadedObject (HeadObject + Magic Bytes) DAT',
      putRes1.status === 200 && verified1.valid === true && verified1.fileSize === VALID_PNG_BUFFER.length,
      `PUT=${putRes1.status}, actualSize=${verified1.fileSize} bytes, mime=${verified1.mimeType}`
    );

    // ----------------------------------------------------------------
    // Test 8: Object khong ton tai, vuot dung luong thuc te hoac sai Magic Bytes khong duoc luu vao DB
    // ----------------------------------------------------------------
    const fakeReq = await request(app)
      .post('/api/media/presigned-url')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        files: [{ fileName: 'disguised.png', mimeType: 'image/png', fileSize: 100 }],
      });
    const disguisedFile = fakeReq.body.data.files[0];

    // Upload noi dung file .exe (MZ header) nhung doi ten la .png
    await fetch(disguisedFile.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: FAKE_EXE_AS_PNG_BUFFER,
    });

    const nonExistentKey = `chats/${chatBoxId}/u_${u1.user.id}/${Date.now()}-0-abcdef-ghost.png`;

    const t8SendRes = await request(app)
      .post('/api/messages/send')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        content: '',
        attachments: [
          { objectKey: nonExistentKey, fileName: 'ghost.png', mimeType: 'image/png', sortOrder: 0 },
          { objectKey: disguisedFile.objectKey, fileName: 'disguised.png', mimeType: 'image/png', sortOrder: 1 },
        ],
      });

    const disguisedInDb = await prisma.messageAttachment.findFirst({
      where: { objectKey: { in: [nonExistentKey, disguisedFile.objectKey] } },
    });

    recordResult(
      8,
      'Object khong ton tai hoac gia mao Magic Bytes (.exe doi ten .png) bi tu choi va khong luu vao DB',
      t8SendRes.status === 400 && disguisedInDb === null,
      `HTTP ${t8SendRes.status} - ${t8SendRes.body.message}`
    );

    // ----------------------------------------------------------------
    // Test 9: Gui tin nhan chi co van ban van hoat dong binh thuong
    // ----------------------------------------------------------------
    const t9Res = await request(app)
      .post('/api/messages/send')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        content: 'Tin nhan van ban thuan Day 3',
      });

    recordResult(
      9,
      'Gui tin nhan chi co van ban van hoat dong binh thuong',
      t9Res.status === 201 &&
        t9Res.body.data.message.content === 'Tin nhan van ban thuan Day 3' &&
        t9Res.body.data.message.attachments.length === 0,
      `messageId=${t9Res.body.data?.message?.id}`
    );

    // ----------------------------------------------------------------
    // Test 10: Gui tin nhan chi co anh/video (khong co van ban) hoat dong
    // ----------------------------------------------------------------
    const t10Res = await request(app)
      .post('/api/messages/send')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        content: '',
        attachments: [
          {
            objectKey: file1Info.objectKey,
            fileName: file1Info.fileName,
            mimeType: file1Info.mimeType,
            fileSize: VALID_PNG_BUFFER.length,
            sortOrder: 0,
          },
        ],
      });

    recordResult(
      10,
      'Gui tin nhan chi co file anh/video (khong co van ban) hoat dong',
      t10Res.status === 201 &&
        t10Res.body.data.message.content === '' &&
        t10Res.body.data.message.attachments.length === 1 &&
        t10Res.body.data.message.attachments[0].objectKey === file1Info.objectKey,
      `attachmentId=${t10Res.body.data?.message?.attachments?.[0]?.id}`
    );

    // ----------------------------------------------------------------
    // Test 11 & 12: Gui tin nhan co ca van ban va nhieu file (tron anh + video) + giu nguyen thu tu sortOrder
    // ----------------------------------------------------------------
    const multiPresignRes = await request(app)
      .post('/api/media/presigned-url')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        files: [
          { fileName: 'first-image.png', mimeType: 'image/png', fileSize: VALID_PNG_BUFFER.length },
          { fileName: 'second-video.mp4', mimeType: 'video/mp4', fileSize: VALID_MP4_BUFFER.length },
          { fileName: 'third-photo.jpg', mimeType: 'image/jpeg', fileSize: VALID_JPEG_BUFFER.length },
        ],
      });

    const pFiles = multiPresignRes.body.data.files;
    await fetch(pFiles[0].uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: VALID_PNG_BUFFER });
    await fetch(pFiles[1].uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: VALID_MP4_BUFFER });
    await fetch(pFiles[2].uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: VALID_JPEG_BUFFER });

    // Co tinh truyen mang attachments bi dao thu tu trong request body nhung co sortOrder 0, 1, 2
    // Va kem 1 file thu 4 upload that bai (khong ton tai tren MinIO) de test partial upload success
    const failedKey = `chats/${chatBoxId}/u_${u1.user.id}/${Date.now()}-3-zzzzzz-failed.png`;

    const t11Res = await request(app)
      .post('/api/messages/send')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        content: 'Album anh va video chuyen di',
        attachments: [
          { objectKey: pFiles[2].objectKey, fileName: pFiles[2].fileName, mimeType: pFiles[2].mimeType, sortOrder: 2 },
          { objectKey: failedKey, fileName: 'failed.png', mimeType: 'image/png', sortOrder: 3 },
          { objectKey: pFiles[0].objectKey, fileName: pFiles[0].fileName, mimeType: pFiles[0].mimeType, sortOrder: 0 },
          { objectKey: pFiles[1].objectKey, fileName: pFiles[1].fileName, mimeType: pFiles[1].mimeType, sortOrder: 1 },
        ],
      });

    const savedAtts = t11Res.body.data?.message?.attachments || [];
    recordResult(
      11,
      'Gui tin nhan ket hop van ban + nhieu file (anh & video) va bo qua file upload loi',
      t11Res.status === 201 &&
        t11Res.body.data.message.content === 'Album anh va video chuyen di' &&
        savedAtts.length === 3,
      `savedAttachments=${savedAtts.length}/3`
    );

    const isOrderPreserved =
      savedAtts.length === 3 &&
      savedAtts[0].fileName === 'first-image.png' &&
      savedAtts[0].sortOrder === 0 &&
      savedAtts[1].fileName === 'second-video.mp4' &&
      savedAtts[1].sortOrder === 1 &&
      savedAtts[2].fileName === 'third-photo.jpg' &&
      savedAtts[2].sortOrder === 2 &&
      Boolean(savedAtts[0].viewUrl);

    recordResult(
      12,
      'Thu tu Attachments (sortOrder 0, 1, 2) duoc giu nguyen chinh xac va co viewUrl tam thoi',
      isOrderPreserved,
      `order=[${savedAtts.map((a) => `${a.sortOrder}:${a.fileName}`).join(', ')}]`
    );

    // ----------------------------------------------------------------
    // Test 13: Transaction bao dam Message va Attachments duoc luu dong bo (Rollback khi loi)
    // ----------------------------------------------------------------
    const countBeforeTx = await prisma.message.count({ where: { chatBoxId } });
    const messageRepo = new MessageRepository(prisma);
    let txRolledBack = false;

    try {
      // Truyen chatBoxId khong ton tai (99999999) de buoc buoc cap nhat/khoa ngoai trong transaction that bai
      await prisma.$transaction(async (tx) => {
        await tx.message.create({
          data: {
            chatBoxId,
            senderId: u1.user.id,
            content: 'Tin nhan se bi rollback',
            attachments: {
              create: [
                {
                  objectKey: 'chats/rollback/test.png',
                  fileName: 'test.png',
                  mimeType: 'image/png',
                  fileSize: 100,
                  sortOrder: 0,
                },
              ],
            },
          },
        });
        // Gay loi o buoc update chatBox trong cung transaction
        await tx.chatBox.update({
          where: { id: -999999 },
          data: { updatedAt: new Date() },
        });
      });
    } catch (txErr) {
      txRolledBack = true;
    }

    const countAfterTx = await prisma.message.count({ where: { chatBoxId } });
    const orphanAtt = await prisma.messageAttachment.findFirst({
      where: { objectKey: 'chats/rollback/test.png' },
    });

    recordResult(
      13,
      'Transaction bao dam Message va Attachments rollback dong bo khi co loi',
      txRolledBack && countBeforeTx === countAfterTx && orphanAtt === null && typeof messageRepo.create === 'function',
      `countBefore=${countBeforeTx}, countAfter=${countAfterTx}`
    );

    // ----------------------------------------------------------------
    // Test 14: Nguoi dung khong the xem hoac xoa file thuoc ChatBox khac
    // ----------------------------------------------------------------
    // u3 (khong thuoc chatBoxId) co xem file cua chatBoxId
    const viewByOutsider = await request(app)
      .get('/api/media/view-url')
      .set('Authorization', `Bearer ${u3.token}`)
      .query({ chatBoxId, objectKey: file1Info.objectKey });

    // u3 dung otherChatBoxId (ma u3 la thanh vien) nhung truyen objectKey cua chatBoxId
    const viewCrossChatBox = await request(app)
      .get('/api/media/view-url')
      .set('Authorization', `Bearer ${u3.token}`)
      .query({ chatBoxId: otherChatBoxId, objectKey: file1Info.objectKey });

    // u2 (cung chatBoxId) co xoa file tam do u1 tao
    const tempForU1Res = await request(app)
      .post('/api/media/presigned-url')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        files: [{ fileName: 'u1-temp.png', mimeType: 'image/png', fileSize: VALID_PNG_BUFFER.length }],
      });
    const u1TempFile = tempForU1Res.body.data.files[0];
    await fetch(u1TempFile.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: VALID_PNG_BUFFER });

    const deleteByOtherUser = await request(app)
      .post('/api/media/cleanup')
      .set('Authorization', `Bearer ${u2.token}`)
      .send({ chatBoxId, objectKeys: [u1TempFile.objectKey] });

    const u1TempStillOnMinio = await storageService.checkFileExists(u1TempFile.objectKey);

    recordResult(
      14,
      'Chan xem file cua ChatBox khac (403) va chan xoa file tam cua nguoi dung khac',
      viewByOutsider.status === 403 &&
        viewCrossChatBox.status === 403 &&
        deleteByOtherUser.body.data.deletedKeys.length === 0 &&
        deleteByOtherUser.body.data.rejectedKeys.length === 1 &&
        u1TempStillOnMinio === true,
      `viewOutsider=${viewByOutsider.status}, viewCrossChat=${viewCrossChatBox.status}`
    );

    // ----------------------------------------------------------------
    // Test 15: Cleanup xoa file tam cua chinh minh nhung KHONG xoa file da gan voi MessageAttachment
    // ----------------------------------------------------------------
    const cleanupRes = await request(app)
      .post('/api/media/cleanup')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        objectKeys: [
          u1TempFile.objectKey, // File tam chua gui -> PHAI XOA
          file1Info.objectKey,  // File da gan voi Message o Test 10 -> PHAI BAO VE
        ],
      });

    const tempExistsAfterCleanup = await storageService.checkFileExists(u1TempFile.objectKey);
    const attachedExistsAfterCleanup = await storageService.checkFileExists(file1Info.objectKey);

    // Kiem tra them Lop 2: Cleanup du phong 30 phut (voi file moi tao < 30 phut va file dang pending)
    const fallbackRes = await messageService.cleanupExpiredOrphanFiles({ maxAgeMs: 30 * 60 * 1000 });
    const attachedStillExistsAfterFallback = await storageService.checkFileExists(file1Info.objectKey);

    recordResult(
      15,
      'Cleanup (Lop 1 & Lop 2) xoa dung file tam va BAO VE file da gan voi MessageAttachment',
      cleanupRes.status === 200 &&
        cleanupRes.body.data.deletedKeys.includes(u1TempFile.objectKey) &&
        cleanupRes.body.data.skippedAttachedKeys.includes(file1Info.objectKey) &&
        tempExistsAfterCleanup === false &&
        attachedExistsAfterCleanup === true &&
        attachedStillExistsAfterFallback === true &&
        typeof fallbackRes.scannedCount === 'number',
      `deleted=${cleanupRes.body.data.deletedKeys.length}, protected=${cleanupRes.body.data.skippedAttachedKeys.length}`
    );

    // ----------------------------------------------------------------
    // Test 16: Bucket khong con cho phep truy cap cong khai, chi xem duoc qua Pre-signed GET URL
    // ----------------------------------------------------------------
    const directPublicUrl = `${storageService.publicEndpoint}/${storageService.bucket}/${file1Info.objectKey}`;
    const directGetRes = await fetch(directPublicUrl);

    const signedViewRes = await request(app)
      .get('/api/media/view-url')
      .set('Authorization', `Bearer ${u2.token}`)
      .query({ chatBoxId, objectKey: file1Info.objectKey });

    const signedFetchRes = await fetch(signedViewRes.body.data.viewUrl);
    const signedDownloadedBuf = Buffer.from(await signedFetchRes.arrayBuffer());

    recordResult(
      16,
      'Bucket o che do Private (truy cap truc tiep bi chan 403, xem qua Pre-signed GET URL 200 OK)',
      directGetRes.status === 403 &&
        signedViewRes.status === 200 &&
        signedViewRes.body.data.expiresIn === 3600 &&
        signedFetchRes.status === 200 &&
        Buffer.compare(VALID_PNG_BUFFER, signedDownloadedBuf) === 0,
      `directPublicStatus=${directGetRes.status}, signedGetStatus=${signedFetchRes.status}`
    );
  } catch (err) {
    console.error('Loi nghiem trong khi chay test Day 3:', err);
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\n=== KET QUA TONG KET DAY 3: ${passed}/${total} TESTS THANH CONG ===`);
  if (passed !== total || total < 16) {
    process.exit(1);
  }
  process.exit(0);
}

runDay3Tests();
