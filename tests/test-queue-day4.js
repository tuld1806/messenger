/**
 * Kich ban kiem thu toan dien Day 4 - BullMQ, Redis, MessageWorker, Retry, Idempotency & Socket.IO
 * Chay: node tests/test-queue-day4.js
 */
require('dotenv').config();
const request = require('supertest');
const createApp = require('../src/app');
const prisma = require('../src/config/prisma');
const MessageQueue = require('../src/core/queues/messageQueue');
const { createMessageWorker } = require('../src/workers/MessageWorker');
const { initSocket } = require('../src/socket/socketHandler');

// Buffer anh PNG 1x1 hop le
const VALID_PNG_BUFFER = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d420000000049454e44ae426082',
  'hex'
);

// Buffer anh JPEG hop le
const VALID_JPEG_BUFFER = Buffer.from(
  'ffd8ffe000104a46494600010101004800480000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffd9',
  'hex'
);

// Buffer video MP4 hop le
const VALID_MP4_BUFFER = Buffer.from(
  '000000186674797069736f6d0000020069736f6d69736f326d703431000000086d646174',
  'hex'
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  return {
    user: res.body.data.user,
    token: res.body.data.token,
  };
}

// Doi cho den khi tin nhan voi clientMessageId xuat hien trong MariaDB
async function waitForPersistedMessage(clientMessageId, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await prisma.message.findUnique({
      where: { clientMessageId },
      include: {
        sender: { select: { id: true, username: true, name: true } },
        attachments: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (found) return found;
    await sleep(100);
  }
  return null;
}

async function runDay4Tests() {
  console.log('=== BAT DAU KIEM THU TOAN DIEN DAY 4 (BULLMQ + REDIS + MESSAGE WORKER) ===\n');

  const { app, messageService, storageService, messageQueue } = createApp({
    enableQueue: true,
  });

  // Don sach hang doi truoc khi test
  await messageQueue.queue.obliterate({ force: true }).catch(() => {});

  // Flag mo phong loi DB tam thoi o Test 7
  let failFirstAttemptForClientMsgId = null;
  let retryAttemptCount = 0;

  // Khoi tao MessageWorker ket noi cung Redis va MariaDB
  const workerInstance = createMessageWorker({
    beforePersist: async (job) => {
      if (
        failFirstAttemptForClientMsgId &&
        job.data?.clientMessageId === failFirstAttemptForClientMsgId
      ) {
        retryAttemptCount++;
        if (retryAttemptCount === 1) {
          throw new Error('Mo phong loi ket noi DB tam thoi o lan thu 1');
        }
      }
    },
  });

  // Thiet lap mo phong Socket.IO Server ket noi voi initSocket va QueueEvents that tren Redis
  const emittedRoomEvents = [];
  const emittedSocketEvents = [];
  const connectionHandlers = [];

  const mockIo = {
    sockets: {
      adapter: {
        rooms: new Map(),
      },
    },
    use: () => {},
    on: (event, handler) => {
      if (event === 'connection') {
        connectionHandlers.push(handler);
      }
    },
    emit: () => {},
    to: (target) => ({
      emit: (eventName, payload) => {
        emittedRoomEvents.push({ target, eventName, payload });
      },
    }),
  };

  const socketController = initSocket(mockIo, messageService);

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
    const u1 = await ensureTestUser(app, 'day4_sender', 'Day4 Sender');
    const u2 = await ensureTestUser(app, 'day4_receiver', 'Day4 Receiver');

    const chatBoxRes = await request(app)
      .post('/api/messages/chatbox')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ recipientId: u2.user.id });
    const chatBoxId = chatBoxRes.body.data.id;

    // ----------------------------------------------------------------
    // Test 1: Gui tin nhan van ban qua Queue va Worker luu DB
    // ----------------------------------------------------------------
    const t1ClientMsgId = `day4_t1_${Date.now()}`;
    const t1Res = await request(app)
      .post('/api/messages/send')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        content: 'Tin nhan van ban Day 4 qua BullMQ',
        clientMessageId: t1ClientMsgId,
      });

    const t1Saved = await waitForPersistedMessage(t1ClientMsgId);
    recordResult(
      1,
      'Gui tin nhan van ban qua BullMQ Queue va Worker luu DB thanh cong',
      t1Res.status === 202 &&
        t1Res.body.data.status === 'queued' &&
        t1Saved !== null &&
        t1Saved.content === 'Tin nhan van ban Day 4 qua BullMQ',
      `HTTP ${t1Res.status} (status=${t1Res.body.data?.status}) -> DB messageId=${t1Saved?.id}`
    );

    // ----------------------------------------------------------------
    // Test 2: Gui tin nhan chi co attachments (media-only)
    // ----------------------------------------------------------------
    const presignT2 = await request(app)
      .post('/api/media/presigned-url')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        files: [{ fileName: 'media-only.png', mimeType: 'image/png', fileSize: VALID_PNG_BUFFER.length }],
      });
    const fT2 = presignT2.body.data.files[0];
    await fetch(fT2.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: VALID_PNG_BUFFER });

    const t2ClientMsgId = `day4_t2_${Date.now()}`;
    const t2Res = await request(app)
      .post('/api/messages/send')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        content: '',
        clientMessageId: t2ClientMsgId,
        attachments: [
          { objectKey: fT2.objectKey, fileName: fT2.fileName, mimeType: fT2.mimeType, sortOrder: 0 },
        ],
      });

    const t2Saved = await waitForPersistedMessage(t2ClientMsgId);
    recordResult(
      2,
      'Gui tin nhan chi co attachments (media-only) qua Queue va Worker luu DB',
      t2Res.status === 202 &&
        t2Saved !== null &&
        t2Saved.content === '' &&
        t2Saved.attachments.length === 1 &&
        t2Saved.attachments[0].objectKey === fT2.objectKey,
      `DB messageId=${t2Saved?.id}, attachments=${t2Saved?.attachments?.length}`
    );

    // ----------------------------------------------------------------
    // Test 3: Gui tin nhan co ca van ban va attachment
    // ----------------------------------------------------------------
    const presignT3 = await request(app)
      .post('/api/media/presigned-url')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        files: [{ fileName: 'caption-photo.jpg', mimeType: 'image/jpeg', fileSize: VALID_JPEG_BUFFER.length }],
      });
    const fT3 = presignT3.body.data.files[0];
    await fetch(fT3.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: VALID_JPEG_BUFFER });

    const t3ClientMsgId = `day4_t3_${Date.now()}`;
    const t3Res = await request(app)
      .post('/api/messages/send')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        content: 'Tin nhan kem anh JPG',
        clientMessageId: t3ClientMsgId,
        attachments: [
          { objectKey: fT3.objectKey, fileName: fT3.fileName, mimeType: fT3.mimeType, sortOrder: 0 },
        ],
      });

    const t3Saved = await waitForPersistedMessage(t3ClientMsgId);
    recordResult(
      3,
      'Gui tin nhan co ca van ban va attachment qua Queue',
      t3Res.status === 202 &&
        t3Saved !== null &&
        t3Saved.content === 'Tin nhan kem anh JPG' &&
        t3Saved.attachments.length === 1,
      `DB messageId=${t3Saved?.id}`
    );

    // ----------------------------------------------------------------
    // Test 4: Gui nhieu attachments (3 files: PNG + MP4 + JPG) trong 1 tin nhan
    // ----------------------------------------------------------------
    const presignT4 = await request(app)
      .post('/api/media/presigned-url')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        files: [
          { fileName: 'multi-1.png', mimeType: 'image/png', fileSize: VALID_PNG_BUFFER.length },
          { fileName: 'multi-2.mp4', mimeType: 'video/mp4', fileSize: VALID_MP4_BUFFER.length },
          { fileName: 'multi-3.jpg', mimeType: 'image/jpeg', fileSize: VALID_JPEG_BUFFER.length },
        ],
      });
    const pT4 = presignT4.body.data.files;
    await fetch(pT4[0].uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: VALID_PNG_BUFFER });
    await fetch(pT4[1].uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: VALID_MP4_BUFFER });
    await fetch(pT4[2].uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: VALID_JPEG_BUFFER });

    const t4ClientMsgId = `day4_t4_${Date.now()}`;
    await request(app)
      .post('/api/messages/send')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        content: 'Tin nhan 3 tep dinh kem',
        clientMessageId: t4ClientMsgId,
        attachments: [
          { objectKey: pT4[2].objectKey, fileName: pT4[2].fileName, mimeType: pT4[2].mimeType, sortOrder: 2 },
          { objectKey: pT4[0].objectKey, fileName: pT4[0].fileName, mimeType: pT4[0].mimeType, sortOrder: 0 },
          { objectKey: pT4[1].objectKey, fileName: pT4[1].fileName, mimeType: pT4[1].mimeType, sortOrder: 1 },
        ],
      });

    const t4Saved = await waitForPersistedMessage(t4ClientMsgId);
    recordResult(
      4,
      'Gui nhieu attachments trong 1 tin nhan va bao toan thu tu sortOrder trong Transaction',
      t4Saved !== null &&
        t4Saved.attachments.length === 3 &&
        t4Saved.attachments[0].fileName === 'multi-1.png' &&
        t4Saved.attachments[1].fileName === 'multi-2.mp4' &&
        t4Saved.attachments[2].fileName === 'multi-3.jpg',
      `order=[${t4Saved?.attachments?.map((a) => `${a.sortOrder}:${a.fileName}`).join(', ')}]`
    );

    // ----------------------------------------------------------------
    // Test 5: Redis khong hoat dong (ket noi toi cong Redis sai 6399)
    // ----------------------------------------------------------------
    const brokenQueue = new MessageQueue({
      connection: {
        host: '127.0.0.1',
        port: 6399,
        retryStrategy: () => null,
      },
    });

    let redisDownErrorHandled = false;
    try {
      await brokenQueue.enqueueMessageJob({
        clientMessageId: `broken_${Date.now()}`,
        chatBoxId,
        senderId: u1.user.id,
        content: 'Tin nhan khi Redis sap',
      });
    } catch (redisErr) {
      redisDownErrorHandled = redisErr.message.includes('Redis khong hoat dong');
    } finally {
      await brokenQueue.close();
    }

    recordResult(
      5,
      'Xu ly loi an toan khi Redis khong hoat dong (khong crash server)',
      redisDownErrorHandled === true,
      'Bat va tra thong bao loi Redis ro rang'
    );

    // ----------------------------------------------------------------
    // Test 6: Worker tam thoi khong hoat dong (Paused) -> Cleanup khong xoa file pending -> Worker Resume xu ly tiep
    // ----------------------------------------------------------------
    await workerInstance.worker.pause();

    const presignT6 = await request(app)
      .post('/api/media/presigned-url')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        files: [{ fileName: 'while-worker-paused.png', mimeType: 'image/png', fileSize: VALID_PNG_BUFFER.length }],
      });
    const fT6 = presignT6.body.data.files[0];
    await fetch(fT6.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: VALID_PNG_BUFFER });

    const t6ClientMsgId = `day4_t6_${Date.now()}`;
    const t6QueueRes = await request(app)
      .post('/api/messages/send')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        content: 'Gui khi Worker dang tam dung',
        clientMessageId: t6ClientMsgId,
        attachments: [
          { objectKey: fT6.objectKey, fileName: fT6.fileName, mimeType: fT6.mimeType, sortOrder: 0 },
        ],
      });

    // Kiem tra ngay luc Worker dang pause: tin nhan chua vao DB
    const beforeResumeInDb = await prisma.message.findUnique({
      where: { clientMessageId: t6ClientMsgId },
    });

    // Goi Cleanup trong luc Job dang nam trong Queue cho Worker -> Phai BAO VE file pending!
    const cleanupWhileQueued = await request(app)
      .post('/api/media/cleanup')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ chatBoxId, objectKeys: [fT6.objectKey] });

    const fileExistsWhilePaused = await storageService.checkFileExists(fT6.objectKey);

    // Resume Worker de xu ly Job
    workerInstance.worker.resume();
    const afterResumeInDb = await waitForPersistedMessage(t6ClientMsgId);

    recordResult(
      6,
      'Worker tam dung: Tin nhan xep hang an toan, Cleanup bao ve file pending, Worker chay lai luu DB thanh cong',
      t6QueueRes.status === 202 &&
        beforeResumeInDb === null &&
        cleanupWhileQueued.body.data.deletedKeys.length === 0 &&
        fileExistsWhilePaused === true &&
        afterResumeInDb !== null,
      `beforeResume=null, fileProtected=${fileExistsWhilePaused}, afterResumeId=${afterResumeInDb?.id}`
    );

    // ----------------------------------------------------------------
    // Test 7: Worker xu ly Job that bai o lan 1 va BullMQ tu dong Retry thanh cong o lan 2
    // ----------------------------------------------------------------
    const t7ClientMsgId = `day4_t7_retry_${Date.now()}`;
    failFirstAttemptForClientMsgId = t7ClientMsgId;
    retryAttemptCount = 0;

    await request(app)
      .post('/api/messages/send')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({
        chatBoxId,
        content: 'Tin nhan kiem thu BullMQ Retry Exponential Backoff',
        clientMessageId: t7ClientMsgId,
      });

    const t7Saved = await waitForPersistedMessage(t7ClientMsgId, 10000);
    failFirstAttemptForClientMsgId = null;

    recordResult(
      7,
      'Worker gap loi tam thoi o attempt 1 va BullMQ tu dong Retry thanh cong o attempt 2',
      t7Saved !== null && retryAttemptCount === 2,
      `attemptsExecuted=${retryAttemptCount}, savedMessageId=${t7Saved?.id}`
    );

    // ----------------------------------------------------------------
    // Test 8: Mot Job duoc xu ly lai nhung khong tao Message trung lap (Idempotency)
    // ----------------------------------------------------------------
    const duplicateJobFake = {
      id: t7ClientMsgId,
      data: {
        clientMessageId: t7ClientMsgId,
        chatBoxId,
        senderId: u1.user.id,
        recipientId: u2.user.id,
        content: 'Tin nhan kiem thu BullMQ Retry Exponential Backoff',
        attachments: [],
      },
    };

    const reprocessedResult = await workerInstance.processJob(duplicateJobFake);
    const duplicateCountInDb = await prisma.message.count({
      where: { clientMessageId: t7ClientMsgId },
    });

    recordResult(
      8,
      'Job duoc xu ly lai voi cung clientMessageId khong tao Message trung lap trong DB',
      duplicateCountInDb === 1 && reprocessedResult.message.id === t7Saved.id,
      `duplicateCountInDb=${duplicateCountInDb}, messageId=${reprocessedResult.message.id}`
    );

    // ----------------------------------------------------------------
    // Test 9: Tich hop Socket.IO: Nguoi gui nhan message_queued va thanh vien ChatBox nhan message_persisted
    // ----------------------------------------------------------------
    emittedRoomEvents.length = 0;
    emittedSocketEvents.length = 0;

    const socketHandlersMap = {};
    const mockSenderSocket = {
      id: 'socket_sender_day4',
      user: { id: u1.user.id, username: u1.user.username },
      join: (room) => {
        if (!mockIo.sockets.adapter.rooms.has(room)) {
          mockIo.sockets.adapter.rooms.set(room, new Set());
        }
        mockIo.sockets.adapter.rooms.get(room).add('socket_sender_day4');
      },
      leave: () => {},
      to: () => ({ emit: () => {} }),
      on: (event, fn) => {
        socketHandlersMap[event] = fn;
      },
      emit: (eventName, payload) => {
        emittedSocketEvents.push({ eventName, payload });
      },
    };

    // Gia lap u1 ket noi va join vao room chatBoxId
    connectionHandlers[0](mockSenderSocket);
    socketHandlersMap['join_chat']({ chatBoxId });

    const t9ClientMsgId = `day4_t9_socket_${Date.now()}`;
    let ackResponse = null;

    await socketHandlersMap['send_message'](
      {
        chatBoxId,
        content: 'Tin nhan Socket real-time qua BullMQ Day 4',
        clientMessageId: t9ClientMsgId,
      },
      (ack) => {
        ackResponse = ack;
      }
    );

    const queuedEvent = emittedSocketEvents.find(
      (e) => e.eventName === 'message_queued' && e.payload?.clientMessageId === t9ClientMsgId
    );

    // Cho Worker luu DB va QueueEvents phat message_persisted ve Socket.IO
    await waitForPersistedMessage(t9ClientMsgId);
    await sleep(400);

    const persistedEvent = emittedRoomEvents.find(
      (e) =>
        e.target === `chat_${chatBoxId}` &&
        e.eventName === 'message_persisted' &&
        e.payload?.clientMessageId === t9ClientMsgId
    );

    recordResult(
      9,
      'Socket.IO: Nguoi gui nhan message_queued ngay khi vao Queue va ChatBox nhan message_persisted sau khi luu DB',
      Boolean(queuedEvent) &&
        ackResponse?.status === 'queued' &&
        Boolean(persistedEvent) &&
        persistedEvent.payload?.status === 'persisted' &&
        persistedEvent.payload?.message?.id > 0,
      `queuedEvent=${Boolean(queuedEvent)}, persistedEvent=${Boolean(persistedEvent)} (msgId=${persistedEvent?.payload?.message?.id})`
    );
  } catch (err) {
    console.error('Loi nghiem trong khi chay test Day 4:', err);
  } finally {
    await socketController.closeQueueEvents();
    await workerInstance.close();
    await messageQueue.close();
    await prisma.$disconnect();
  }

  console.log(`\n=== KET QUA TONG KET DAY 4: ${passed}/${total} TESTS THANH CONG ===`);
  if (passed !== total || total < 9) {
    process.exit(1);
  }
  process.exit(0);
}

runDay4Tests();
