# Phase 1: Real-Time Messenger Cloud Architecture Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triển khai Giai đoạn 1 của lộ trình cải tiến kiến trúc Cloud-Agnostic: Tích hợp Redis Pub/Sub Adapter cho Socket.IO để mở rộng ngang, chuyển đổi Presence Store từ in-memory RAM sang Redis, tối ưu hóa Composite Indexes cho Database và áp dụng Valet Key Pattern (Pre-signed Upload) với Object Storage (MinIO/S3).

**Architecture:** Nâng cấp hệ thống Monolith hiện tại thành State-Decoupled Monolith sẵn sàng scale ngang. Toàn bộ socket events và user presence được đồng bộ phân tán qua Redis Cluster (`@socket.io/redis-adapter` và Redis Hashes/Sets). Các tệp tin media được tải trực tiếp lên Object Storage qua Pre-signed URLs mà không đi qua băng thông của backend.

**Tech Stack:** Node.js (Express 5), Socket.IO v4, Prisma ORM v7, MariaDB/MySQL, Redis (`ioredis`, `@socket.io/redis-adapter`), Object Storage SDK (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`), Jest, Supertest.

**Spec:** [`docs/superpowers/specs/2026-11-10-cloud-architecture-redesign.md`](file:///d:/code/project/messenger/docs/superpowers/specs/2026-11-10-cloud-architecture-redesign.md)

---

## Global Constraints

- Mọi thay đổi phải tương thích ngược (Backwards Compatible) với Web Client hiện tại (`public/js/app.js`) và các API đang chạy.
- Redis client phải có cơ chế fallback hoặc graceful handling khi Redis chưa khởi chạy / disconnect trong môi trường test cục bộ.
- Cơ sở dữ liệu MariaDB/MySQL phải bảo toàn dữ liệu hiện có khi thực hiện migration schema.
- Chuẩn mã nguồn: Tuân thủ cấu trúc layered (`src/config`, `src/core/services`, `src/core/repositories`, `src/api`).
- TDD bắt buộc: Mỗi task phải có unit test kiểm thử độc lập trước và sau khi hoàn thiện code nghiệp vụ.

## Review Focus

1. **Redis Connection Drop / Recovery:** Khi kết nối Redis bị gián đoạn đột ngột, server không được crash mà phải log lỗi cảnh báo và thử kết nối lại với Exponential Backoff.
2. **Socket Disconnect & Multiple Tabs:** Một user có thể mở nhiều tab (nhiều `socket.id`). Khi đóng 1 tab, trạng thái `online` của user chỉ chuyển sang `offline` khi TẤT CẢ socket của user đó đã ngắt kết nối.
3. **Pre-signed URL Tampering & Expiry:** Pre-signed URL phải có thời hạn hết hạn chính xác (300 giây) và giới hạn loại MIME (chỉ cho phép ảnh, video, âm thanh, tài liệu), chặn file thực thi độc hại (`.exe`, `.sh`, `.bat`).
4. **Database Query Performance on Large Datasets:** Truy vấn lịch sử tin nhắn với Composite Index `(chatBoxId, createdAt)` phải sử dụng đúng index và không thực hiện filesort.
5. **Rate Limiting Socket Flooding:** Nếu client spam liên tục nhiều hơn 5 tin nhắn/giây qua socket `send_message`, hệ thống phải từ chối kèm mã lỗi `RATE_LIMIT_EXCEEDED` mà không ngắt toàn bộ kết nối socket.

---

## Task Decomposition

### Task 1: Database Indexing & Cursor-Based Pagination Support

**Files:**
- Modify: `prisma/schema.prisma:40-52`
- Modify: `src/core/repositories/MessageRepository.js:32-44`
- Test: `tests/unit/message.repository.test.js`

**Interfaces:**
- Consumes: Prisma Client instance
- Produces: `MessageRepository.findByChatBoxId(chatBoxId, { limit, cursor, skip })` hỗ trợ cả Cursor-based lẫn Offset-based pagination.

- [ ] **Step 1: Write the failing test for composite indexing and cursor pagination**

Create `tests/unit/message.repository.test.js` testing cursor-based query ordering and filtering:
```javascript
describe('MessageRepository - Cursor Pagination & Indexing', () => {
  it('should fetch messages using cursor correctly', async () => {
    // Expect findByChatBoxId with cursor to use cursor parameter in prisma query
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/message.repository.test.js`
Expected: FAIL (cursor pagination option not handled in repository).

- [ ] **Step 3: Update `prisma/schema.prisma` with Composite Indexes**

In `prisma/schema.prisma`, add composite index to `Message` model:
```prisma
model Message {
  id        Int      @id @default(autoincrement())
  chatBoxId Int
  senderId  Int
  content   String   @db.Text
  isRead    Boolean  @default(false)
  createdAt DateTime @default(now())

  chatBox ChatBox @relation(fields: [chatBoxId], references: [id])
  sender  User    @relation(fields: [senderId], references: [id])

  @@index([chatBoxId, createdAt])
  @@map("messages")
}
```

- [ ] **Step 4: Update `MessageRepository.js` to support cursor-based query**

Update `findByChatBoxId` in `src/core/repositories/MessageRepository.js`:
```javascript
async findByChatBoxId(chatBoxId, { limit = 50, skip = 0, cursor = null } = {}) {
  const queryOptions = {
    where: { chatBoxId: parseInt(chatBoxId, 10) },
    include: {
      sender: {
        select: { id: true, username: true, name: true, avatar: true },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  };

  if (cursor) {
    queryOptions.cursor = { id: parseInt(cursor, 10) };
    queryOptions.skip = 1; // Skip the cursor itself
  } else if (skip) {
    queryOptions.skip = skip;
  }

  return await this.prisma.message.findMany(queryOptions);
}
```

- [ ] **Step 5: Run tests and regenerate Prisma client**

Run: `npx jest tests/unit/message.repository.test.js`
Run: `npm test`
Expected: PASS all tests.

- [ ] **Step 6: Commit changes**

```bash
git add prisma/schema.prisma src/core/repositories/MessageRepository.js tests/unit/message.repository.test.js
git commit -m "perf: add composite indexes to Message schema and support cursor pagination"
```

---

### Task 2: Redis Client Infrastructure & Distributed Presence Store

**Files:**
- Create: `src/config/redis.js`
- Create: `src/core/services/PresenceService.js`
- Test: `tests/unit/presence.service.test.js`

**Interfaces:**
- Consumes: `REDIS_URL` from environment variables (defaults to `redis://localhost:6379`)
- Produces: `PresenceService` class with methods:
  * `setUserOnline(userId: number, socketId: string): Promise<boolean>`
  * `setUserOffline(userId: number, socketId: string): Promise<boolean>` (returns true only if user has no remaining sockets)
  * `getUserSocketIds(userId: number): Promise<string[]>`
  * `isUserOnline(userId: number): Promise<boolean>`
  * `getOnlineUsers(): Promise<number[]>`

- [ ] **Step 1: Write the failing test for `PresenceService`**

Create `tests/unit/presence.service.test.js` covering multi-socket connection, disconnection, and online queries.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/presence.service.test.js`
Expected: FAIL (modules `redis.js` and `PresenceService.js` do not exist).

- [ ] **Step 3: Implement `src/config/redis.js`**

Implement connection manager using `ioredis` with auto-reconnect, error suppression in test environments, and standalone singleton instances for General Cache, Pub client, and Sub client.

- [ ] **Step 4: Implement `src/core/services/PresenceService.js`**

Use Redis Sets with key pattern `user:sockets:{userId}` and a central Set `online_users`:
- When socket connects: `SADD user:sockets:{userId} {socketId}` and `SADD online_users {userId}`.
- When socket disconnects: `SREM user:sockets:{userId} {socketId}`. If `SCARD user:sockets:{userId} === 0`, remove from `online_users` and return `true` (signaling user is fully offline).

- [ ] **Step 5: Run tests and verify PASS**

Run: `npx jest tests/unit/presence.service.test.js`
Expected: PASS.

- [ ] **Step 6: Commit changes**

```bash
git add src/config/redis.js src/core/services/PresenceService.js tests/unit/presence.service.test.js
git commit -m "feat: implement Redis client config and distributed PresenceService"
```

---

### Task 3: Socket.IO Redis Adapter Integration for Horizontal Scaling

**Files:**
- Modify: `src/server.js:19-28`
- Modify: `src/socket/socketHandler.js:1-137`
- Test: `tests/unit/socket.handler.test.js`

**Interfaces:**
- Consumes: `PresenceService`, Redis Pub/Sub clients, `MessageService`
- Produces: Clustered Socket.IO Server supporting multi-node pub/sub message broadcast.

- [ ] **Step 1: Write failing test for SocketHandler with PresenceService**

Create or update `tests/unit/socket.handler.test.js` verifying that `socketHandler` delegates online tracking to `PresenceService` and properly broadcasts status transitions.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/socket.handler.test.js`
Expected: FAIL.

- [ ] **Step 3: Integrate `@socket.io/redis-adapter` into `src/server.js`**

In `src/server.js`, configure the adapter:
```javascript
const { createAdapter } = require('@socket.io/redis-adapter');
const { pubClient, subClient } = require('./config/redis');

if (process.env.USE_REDIS === 'true') {
  io.adapter(createAdapter(pubClient, subClient));
  console.log('[Socket.IO] Redis Adapter initialized successfully!');
}
```

- [ ] **Step 4: Refactor `src/socket/socketHandler.js`**

- Remove local `const onlineUsers = new Map();`.
- Inject `presenceService` into `initSocket(io, messageService, presenceService)`.
- Use `await presenceService.setUserOnline(userId, socket.id)` on connection.
- Use `await presenceService.setUserOffline(userId, socket.id)` on disconnect, broadcasting `user_status: offline` only when all sessions of that user are terminated.
- For direct notification: `io.to(userSocketId).emit('conversation_updated', result)` querying socket IDs from `presenceService.getUserSocketIds(recipientId)`.

- [ ] **Step 5: Run tests to verify all pass**

Run: `npx jest tests/unit/socket.handler.test.js`
Run: `npm test`
Expected: PASS (all 14+ existing tests and new socket tests pass).

- [ ] **Step 6: Commit changes**

```bash
git add src/server.js src/socket/socketHandler.js tests/unit/socket.handler.test.js
git commit -m "feat: integrate Redis adapter and PresenceService into Socket.IO server"
```

---

### Task 4: Valet Key Pattern: Object Storage & Pre-signed Media Upload

**Files:**
- Create: `src/config/storage.js`
- Create: `src/core/services/MediaService.js`
- Create: `src/api/controllers/MediaController.js`
- Create: `src/api/routes/mediaRoutes.js`
- Modify: `src/app.js`
- Test: `tests/unit/media.service.test.js`

**Interfaces:**
- Consumes: S3 credentials (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`)
- Produces: REST Endpoint `POST /api/media/upload-url` (Protected by `authMiddleware`):
  - Request: `{ fileName: string, fileType: string, fileSize: number, chatBoxId?: number }`
  - Response: `{ uploadUrl: string, publicUrl: string, key: string, expiresIn: number }`

- [ ] **Step 1: Write failing test for `MediaService`**

Create `tests/unit/media.service.test.js` asserting:
- Validates allowed MIME types (`image/jpeg`, `image/png`, `image/gif`, `image/webp`, `video/mp4`, `application/pdf`).
- Rejects files over max size (15MB).
- Generates a signed PUT URL with expiration time of 300 seconds.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/media.service.test.js`
Expected: FAIL (`MediaService` not defined).

- [ ] **Step 3: Implement S3 Storage Config and `MediaService`**

- Create `src/config/storage.js` using `@aws-sdk/client-s3` compatible with MinIO, AWS S3, or Cloudflare R2.
- Create `src/core/services/MediaService.js` using `PutObjectCommand` and `getSignedUrl` from `@aws-sdk/s3-request-presigner`.

- [ ] **Step 4: Create `MediaController.js` and `mediaRoutes.js`**

- `MediaController.getUploadUrl`: Validate request body, call `mediaService.generateUploadUrl()`, return JSON.
- `mediaRoutes.js`: Apply `authMiddleware`, expose `POST /upload-url`.
- Mount `mediaRoutes` in `src/app.js` at `/api/media`.

- [ ] **Step 5: Run tests to verify PASS**

Run: `npx jest tests/unit/media.service.test.js`
Expected: PASS.

- [ ] **Step 6: Commit changes**

```bash
git add src/config/storage.js src/core/services/MediaService.js src/api/controllers/MediaController.js src/api/routes/mediaRoutes.js src/app.js tests/unit/media.service.test.js
git commit -m "feat: implement Valet Key pattern for direct media upload with pre-signed URLs"
```

---

### Task 5: Distributed Rate Limiting & Abuse Prevention

**Files:**
- Create: `src/api/middlewares/rateLimiter.js`
- Modify: `src/api/routes/authRoutes.js:1-40`
- Modify: `src/socket/socketHandler.js:76-107`
- Test: `tests/unit/rate.limiter.test.js`

**Interfaces:**
- Consumes: Redis Client from `src/config/redis.js`
- Produces:
  * `authRateLimiter`: Express middleware limiting login attempts to 5 per 15 minutes per IP.
  * `socketMessageRateLimiter(socket, callback)`: Socket helper limiting `send_message` to 5 msgs/sec per user ID.

- [ ] **Step 1: Write failing test for rate limiters**

Create `tests/unit/rate.limiter.test.js` testing both API route rate limiting (429 Too Many Requests) and Socket message rate limiting (`RATE_LIMIT_EXCEEDED` error response).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/rate.limiter.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `rateLimiter.js`**

Implement using `rate-limiter-flexible` with Redis store:
- `authLimiter`: 5 points, duration: 900 seconds.
- `socketMessageLimiter`: 5 points, duration: 1 second per `userId`.

- [ ] **Step 4: Apply rate limiters to Auth Routes and Socket send_message**

- Attach `authLimiter` to `POST /api/auth/login`.
- In `src/socket/socketHandler.js`, wrap `send_message` handler with `socketMessageLimiter`. If consumed points exceed limit, invoke callback with `{ success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Bạn đang gửi tin nhắn quá nhanh. Vui lòng thử lại sau giây lát.' }`.

- [ ] **Step 5: Run all unit tests**

Run: `npm test`
Expected: All suites PASS.

- [ ] **Step 6: Commit changes**

```bash
git add src/api/middlewares/rateLimiter.js src/api/routes/authRoutes.js src/socket/socketHandler.js tests/unit/rate.limiter.test.js
git commit -m "feat: add distributed rate limiting for auth API and socket messaging"
```

---

## Plan Review & Handoff Checklist

- [x] Every task has explicit test files, code files, and exact signatures.
- [x] Follows TDD (Write failing test -> Run fail -> Implement -> Run pass -> Commit).
- [x] Includes failure modes in the Review Focus section.
- [x] Maintains strict backwards compatibility with existing Messenger features.
