require('dotenv').config();
const { Worker } = require('bullmq');
const prisma = require('../config/prisma');
const MessageRepository = require('../core/repositories/MessageRepository');
const { MESSAGE_QUEUE_NAME } = require('../core/queues/messageQueue');
const {
  createRedisClient,
  unmarkAttachmentsPendingInRedis,
} = require('../config/redis');

/**
 * Khoi tao MessageWorker xu ly Job luu tin nhan tu chat-message-queue
 */
function createMessageWorker(options = {}) {
  const queueName = options.queueName || MESSAGE_QUEUE_NAME;
  const dbClient = options.prisma || prisma;
  const messageRepository = options.messageRepository || new MessageRepository(dbClient);
  const connectionOptions = options.connection || {};

  const workerRedis = createRedisClient(connectionOptions);
  const helperRedis = createRedisClient(connectionOptions);

  // Ham xu ly chinh cho tung Job
  const processJob = async (job) => {
    const {
      clientMessageId,
      chatBoxId,
      senderId,
      recipientId,
      content = '',
      attachments = [],
    } = job.data || {};

    if (!chatBoxId || !senderId) {
      throw new Error('Du lieu Job khong hop le: thieu chatBoxId hoac senderId');
    }

    // Hook tuy chon phuc vu kiem thu retry khi loi tam thoi
    if (typeof options.beforePersist === 'function') {
      await options.beforePersist(job);
    }

    // Luu Message va MessageAttachment trong cung 1 transaction (co chong trung clientMessageId)
    const savedMessage = await messageRepository.create({
      clientMessageId,
      chatBoxId,
      senderId,
      content,
      attachments,
    });

    // Sau khi transaction thanh cong, giai phong trang thai pending tren Redis
    const attachmentKeys = Array.isArray(attachments)
      ? attachments.map((a) => a?.objectKey).filter(Boolean)
      : [];

    if (attachmentKeys.length > 0) {
      await unmarkAttachmentsPendingInRedis(helperRedis, attachmentKeys).catch(() => {});
    }

    return {
      status: 'persisted',
      jobId: job.id,
      clientMessageId: clientMessageId || savedMessage.clientMessageId || null,
      chatBoxId: parseInt(chatBoxId, 10),
      senderId: parseInt(senderId, 10),
      recipientId: recipientId ? parseInt(recipientId, 10) : null,
      message: savedMessage,
    };
  };

  const worker = new Worker(queueName, processJob, {
    connection: workerRedis,
    concurrency: options.concurrency || 5,
  });

  worker.on('completed', (job) => {
    console.log(
      `[MessageWorker] Job ${job.id} (clientMessageId=${job.data?.clientMessageId}) da luu DB thanh cong.`
    );
  });

  worker.on('failed', async (job, err) => {
    const attemptsMade = job?.attemptsMade || 0;
    const maxAttempts = job?.opts?.attempts || 3;
    console.error(
      `[MessageWorker] Job ${job?.id} that bai (lan ${attemptsMade}/${maxAttempts}):`,
      err.message
    );

    // Neu da het so lan retry ma van that bai, giai phong pending de file khong bi giu vinh vien
    if (job && attemptsMade >= maxAttempts) {
      const attachmentKeys = Array.isArray(job.data?.attachments)
        ? job.data.attachments.map((a) => a?.objectKey).filter(Boolean)
        : [];
      if (attachmentKeys.length > 0) {
        await unmarkAttachmentsPendingInRedis(helperRedis, attachmentKeys).catch(() => {});
      }
    }
  });

  worker.on('error', (err) => {
    console.error('[MessageWorker] Loi ket noi Worker:', err.message);
  });

  const close = async () => {
    await worker.close().catch(() => {});
    await workerRedis.quit().catch(() => {});
    await helperRedis.quit().catch(() => {});
  };

  return {
    worker,
    processJob,
    close,
  };
}

// Neu chay truc tiep: node src/workers/MessageWorker.js
if (require.main === module) {
  async function startStandaloneWorker() {
    try {
      await prisma.$connect();
      console.log('[MessageWorker] Da ket noi MariaDB thanh cong.');

      const { close } = createMessageWorker();
      console.log(`[MessageWorker] Dang lang nghe hang doi '${MESSAGE_QUEUE_NAME}'...`);

      const shutdown = async () => {
        console.log('\n[MessageWorker] Dang dung Worker...');
        await close();
        await prisma.$disconnect();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    } catch (err) {
      console.error('[MessageWorker] Khoi dong that bai:', err.message);
      process.exit(1);
    }
  }

  startStandaloneWorker();
}

module.exports = {
  createMessageWorker,
};
