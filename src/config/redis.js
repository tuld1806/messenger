const IORedis = require('ioredis');

const PENDING_KEY_PREFIX = 'messenger:pending_media:';
const DEFAULT_PENDING_TTL_SECONDS = 300; // 5 phut

// Lay cau hinh ket noi Redis tu bien moi truong
function getRedisConnectionOptions(overrides = {}) {
  const host = overrides.host || process.env.REDIS_HOST || '127.0.0.1';
  const port = parseInt(overrides.port || process.env.REDIS_PORT || '6379', 10);
  const password =
    overrides.password !== undefined
      ? overrides.password
      : process.env.REDIS_PASSWORD || undefined;

  const options = {
    host,
    port,
    maxRetriesPerRequest: null, // bat buoc doi voi BullMQ
    enableReadyCheck: false,
    ...overrides,
  };

  if (password) {
    options.password = password;
  } else {
    delete options.password;
  }

  return options;
}

// Tao Redis client voi co che bat loi ket noi ro rang
function createRedisClient(overrides = {}) {
  const options = getRedisConnectionOptions(overrides);
  const client = new IORedis(options);

  client.on('error', (err) => {
    console.error(`[Redis] Loi ket noi (${options.host}:${options.port}):`, err.message);
  });

  return client;
}

// Danh dau cac objectKey dang cho Worker xu ly tren Redis (co TTL de tranh giu vinh vien)
async function markAttachmentsPendingInRedis(redisClient, objectKeys = [], ttlSeconds = DEFAULT_PENDING_TTL_SECONDS) {
  if (!redisClient || !Array.isArray(objectKeys) || objectKeys.length === 0) {
    return;
  }

  for (const key of objectKeys) {
    if (key && typeof key === 'string') {
      await redisClient.set(`${PENDING_KEY_PREFIX}${key.trim()}`, '1', 'EX', ttlSeconds);
    }
  }
}

// Xoa trang thai pending tren Redis sau khi Worker luu DB xong hoac job that bai han
async function unmarkAttachmentsPendingInRedis(redisClient, objectKeys = []) {
  if (!redisClient || !Array.isArray(objectKeys) || objectKeys.length === 0) {
    return;
  }

  const redisKeys = objectKeys
    .filter((k) => typeof k === 'string' && k.trim() !== '')
    .map((k) => `${PENDING_KEY_PREFIX}${k.trim()}`);

  if (redisKeys.length > 0) {
    await redisClient.del(...redisKeys);
  }
}

// Kiem tra objectKey co dang o trang thai pending tren Redis khong
async function isAttachmentPendingInRedis(redisClient, objectKey) {
  if (!redisClient || !objectKey || typeof objectKey !== 'string') {
    return false;
  }

  try {
    const exists = await redisClient.exists(`${PENDING_KEY_PREFIX}${objectKey.trim()}`);
    return exists === 1;
  } catch (err) {
    return false;
  }
}

module.exports = {
  PENDING_KEY_PREFIX,
  DEFAULT_PENDING_TTL_SECONDS,
  getRedisConnectionOptions,
  createRedisClient,
  markAttachmentsPendingInRedis,
  unmarkAttachmentsPendingInRedis,
  isAttachmentPendingInRedis,
};
