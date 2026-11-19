# TÀI LIỆU NGHIÊN CỨU KỸ THUẬT: S3 MINIO VÀ BULLMQ (MESSAGE QUEUE)

**Người thực hiện:** Toàn (Backend Worker & Media)  
**Nhiệm vụ:** Nghiên cứu thư viện chuẩn bị cho Giai đoạn 1 & 2  
**Dự án:** Real-time Messenger  

---

## 1. NGHIÊN CỨU THƯ VIỆN `@aws-sdk/client-s3` (KẾT NỐI MINIO QUA CHUẨN S3)

### 1.1. Mục đích và Vai trò
* **MinIO** là hệ thống lưu trữ đối tượng (Object Storage) mã nguồn mở, tương thích hoàn toàn với chuẩn API của Amazon S3.
* Thay vì client tải file trực tiếp qua server backend Node.js (gây nghẽn CPU, RAM và băng thông), hệ thống áp dụng **Valet Key Pattern**:
  * Backend chỉ sinh một đường dẫn tạm thời (**Pre-signed URL**) có chữ ký số và thời hạn hiệu lực (5 phút).
  * Client sử dụng đường dẫn này để đẩy trực tiếp file lên MinIO qua giao thức `HTTP PUT`.
  * Sau khi upload thành công, client lấy đường dẫn công khai `mediaUrl` gửi vào tin nhắn.

### 1.2. Thư viện sử dụng
* `@aws-sdk/client-s3`: SDK chính thức của AWS (v3) để tương tác với S3/MinIO.
* `@aws-sdk/s3-request-presigner`: Module đi kèm chuyên sinh Pre-signed URL cho các lệnh S3 (PutObjectCommand, GetObjectCommand).

### 1.3. Cấu hình kết nối MinIO từ Node.js
MinIO yêu cầu tham số `forcePathStyle: true` để truy cập bucket theo định dạng `http://<endpoint>/<bucket>/<key>` thay vì định dạng tên miền con `http://<bucket>.<endpoint>/<key>`.

```javascript
const { S3Client, HeadBucketCommand, CreateBucketCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Khoi tao S3 Client ket noi MinIO local
const s3Client = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
  region: process.env.MINIO_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.MINIO_ROOT_USER || '',
    secretAccessKey: process.env.MINIO_ROOT_PASSWORD || '',
  },
  forcePathStyle: true, // Bat buoc de truy cap MinIO bucket theo path
});
```

### 1.4. Quy trình tự động kiểm tra và tạo Bucket (`messenger-media`)
```javascript
async function ensureBucketExists(bucketName) {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === 'NotFound') {
      await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
      console.log(`[MinIO] Da tao bucket moi: ${bucketName}`);
    } else {
      throw error;
    }
  }
}
```

### 1.5. Cơ chế sinh Pre-signed Upload URL
```javascript
async function generatePresignedUrl(bucketName, fileKey, mimeType) {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileKey,
    ContentType: mimeType,
  });

  // URL co hieu luc trong 300 giay (5 phut)
  const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });
  return presignedUrl;
}
```

---

## 2. NGHIÊN CỨU THƯ VIỆN `bullmq` (MESSAGE QUEUE VỚI REDIS)

### 2.1. Mục đích và Vai trò
* **BullMQ** là thư viện hàng đợi công việc (Job/Message Queue) chạy trên nền tảng Redis dành cho Node.js.
* Áp dụng **Queue-Based Load Leveling Pattern**:
  * Khi hàng nghìn người dùng gửi tin nhắn cùng lúc, nếu mỗi tin nhắn đều ghi trực tiếp vào MariaDB ngay lập tức, pool kết nối của cơ sở dữ liệu sẽ bị quá tải, gây nghẽn và timeout.
  * Với Message Queue: Socket Server nhận tin nhắn, phát ngay lập tức tới người nhận qua Redis Pub/Sub, đồng thời đẩy một công việc (Job) vào hàng đợi `chat-message-queue`.
  * Một tiến trình chạy nền độc lập (**Worker**) sẽ lấy dần các tin nhắn từ hàng đợi và ghi vào MariaDB với tốc độ ổn định.

### 2.2. Cấu trúc 2 thành phần chính trong BullMQ

#### A. Producer (Người đẩy việc vào hàng đợi):
```javascript
const { Queue } = require('bullmq');

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
};

const messageQueue = new Queue('chat-message-queue', { connection });

// Day tin nhan vao queue
async function enqueueMessage(messageData) {
  await messageQueue.add('save-message', messageData, {
    attempts: 3, // Thu lai toi da 3 lan neu ghi DB loi
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: true, // Xoa job khoi Redis sau khi hoan tat de tiet kiem RAM
  });
}
```

#### B. Consumer / Worker (Tiến trình lấy việc ra xử lý):
```javascript
const { Worker } = require('bullmq');

const messageWorker = new Worker(
  'chat-message-queue',
  async (job) => {
    const { chatBoxId, senderId, content, mediaUrl } = job.data;
    // Goi MessageRepository ghi vao MariaDB
    return await messageRepository.create({ chatBoxId, senderId, content, mediaUrl });
  },
  {
    connection,
    concurrency: 5, // Xu ly dong thoi 5 job
  }
);

messageWorker.on('completed', (job) => {
  // Co the phat su kien message_persisted xac nhan da luu vao DB
});

messageWorker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job.id} that bai:`, err.message);
});
```

---

## 3. ĐỊNH HƯỚNG TÍCH HỢP VÀO KIẾN TRÚC HIỆN TẠI

1. **Tuân thủ Layered Architecture hiện có:**
   * `StorageService.js` được đặt trong `src/core/services/`, kế thừa trực tiếp cùng giao ước (interface) của `MockStorageService.js` đã dựng ở Giai đoạn 1.
   * `MessageController` hoặc `MediaController` ở tầng API sẽ nhận `StorageService` thông qua cơ chế Dependency Injection tại `src/app.js`.
2. **Không phá vỡ luồng chat hiện tại:**
   * Việc tích hợp MinIO chỉ cung cấp thêm Pre-signed URL cho client. Luồng chat văn bản cũ vẫn hoạt động 100% bình thường.
   * Khi hoàn thành Giai đoạn 2, `MockStorageService` chỉ cần thay thế bằng `StorageService` thật mà không làm xáo trộn các module khác.

