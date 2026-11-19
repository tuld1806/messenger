const { Queue, QueueEvents } = require('bullmq');
const {
  createRedisClient,
  markAttachmentsPendingInRedis,
  unmarkAttachmentsPendingInRedis,
  isAttachmentPendingInRedis,
} = require('../../config/redis');

const MESSAGE_QUEUE_NAME = 'chat-message-queue';

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000, // delay ban dau 1 giay
  },
  removeOnComplete: {
    age: 3600,
    count: 1000,
  },
  removeOnFail: {
    age: 24 * 3600,
  },
};

/**
 * Quan ly hang doi tin nhan chat bang BullMQ
 */
class MessageQueue {
  constructor(options = {}) {
    this.queueName = options.queueName || MESSAGE_QUEUE_NAME;
    this.connectionOptions = options.connection || {};
    this.redisClient =
      options.redisClient ||
      createRedisClient({
        ...this.connectionOptions,
        enableOfflineQueue: false,
      });

    this.queue = new Queue(this.queueName, {
      connection: this.redisClient,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });

    this.queue.on('error', (err) => {
      console.error(`[MessageQueue] Loi hang doi ${this.queueName}:`, err.message);
    });
  }

  // Kiem tra Redis dang hoat dong truoc khi day Job
  async ensureRedisReady() {
    try {
      const pong = await this.redisClient.ping();
      return pong === 'PONG';
    } catch (err) {
      throw new Error(`Redis khong hoat dong hoac mat ket noi: ${err.message}`);
    }
  }

  // Day Job luu tin nhan vao BullMQ Queue
  async enqueueMessageJob(payload, customJobOptions = {}) {
    await this.ensureRedisReady();

    const {
      clientMessageId,
      chatBoxId,
      senderId,
      recipientId,
      content = '',
      attachments = [],
      queuedAt = new Date().toISOString(),
    } = payload || {};

    if (!clientMessageId || !chatBoxId || !senderId) {
      throw new Error('Job tin nhan thieu clientMessageId, chatBoxId hoac senderId');
    }

    const attachmentKeys = Array.isArray(attachments)
      ? attachments.map((a) => a?.objectKey).filter(Boolean)
      : [];

    // Danh dau file dinh kem dang cho Worker xu ly tren Redis (TTL 300s)
    if (attachmentKeys.length > 0) {
      await markAttachmentsPendingInRedis(this.redisClient, attachmentKeys, 300);
    }

    // Chi dua du lieu nghiep vu can thiet vao Job, khong chua JWT hay mat khau
    const cleanJobData = {
      clientMessageId: String(clientMessageId).trim(),
      chatBoxId: parseInt(chatBoxId, 10),
      senderId: parseInt(senderId, 10),
      recipientId: recipientId ? parseInt(recipientId, 10) : null,
      content: content !== undefined && content !== null ? String(content) : '',
      attachments: Array.isArray(attachments)
        ? attachments.map((att, idx) => ({
            objectKey: String(att.objectKey).trim(),
            fileName: String(att.fileName || 'file').trim(),
            mimeType: String(att.mimeType || 'application/octet-stream').trim(),
            fileSize: parseInt(att.fileSize, 10) || 0,
            sortOrder: att.sortOrder !== undefined ? parseInt(att.sortOrder, 10) : idx,
          }))
        : [],
      queuedAt,
    };

    try {
      const job = await this.queue.add('persist-message', cleanJobData, {
        ...DEFAULT_JOB_OPTIONS,
        ...customJobOptions,
        jobId: cleanJobData.clientMessageId,
      });
      return job;
    } catch (err) {
      if (attachmentKeys.length > 0) {
        await unmarkAttachmentsPendingInRedis(this.redisClient, attachmentKeys).catch(() => {});
      }
      throw new Error(`Khong the dua tin nhan vao Queue: ${err.message}`);
    }
  }

  // Kiem tra objectKey co dang cho Worker xu ly tren Redis khong
  async isAttachmentPending(objectKey) {
    return await isAttachmentPendingInRedis(this.redisClient, objectKey);
  }

  // Giai phong trang thai pending tren Redis
  async unmarkAttachmentsPending(objectKeys = []) {
    await unmarkAttachmentsPendingInRedis(this.redisClient, objectKeys);
  }

  // Khoi tao QueueEvents de Backend lang nghe khi Worker luu DB thanh cong
  createQueueEvents() {
    const eventsRedis = createRedisClient(this.connectionOptions);
    const queueEvents = new QueueEvents(this.queueName, {
      connection: eventsRedis,
    });

    queueEvents.on('error', (err) => {
      console.error(`[QueueEvents] Loi ket noi su kien Queue:`, err.message);
    });

    return {
      queueEvents,
      close: async () => {
        await queueEvents.close().catch(() => {});
        await eventsRedis.quit().catch(() => {});
      },
    };
  }

  async close() {
    await this.queue.close().catch(() => {});
    await this.redisClient.quit().catch(() => {});
  }
}

module.exports = MessageQueue;
module.exports.MESSAGE_QUEUE_NAME = MESSAGE_QUEUE_NAME;
module.exports.DEFAULT_JOB_OPTIONS = DEFAULT_JOB_OPTIONS;
