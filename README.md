# 💬 Real-Time Messenger Application

Ứng dụng nhắn tin thời gian thực (Real-time Chat Application) được phát triển bằng **Node.js, Express, Socket.IO, Prisma ORM và MySQL/MariaDB**. Hệ thống hỗ trợ đăng ký, đăng nhập, quản lý người dùng, tạo cuộc trò chuyện 1-1 và truyền nhận tin nhắn trực tiếp với độ trễ thấp.

---

## Tính năng chính

- **Xác thực & Bảo mật:** Đăng ký, đăng nhập tài khoản, mã hóa mật khẩu (`bcryptjs`) và xác thực API bằng **JWT (JSON Web Token)**.
- **Nhắn tin thời gian thực (Real-time Messaging):** Gửi và nhận tin nhắn tức thì thông qua kết nối WebSocket (**Socket.IO**).
- **Quản lý cuộc trò chuyện:** Quản lý danh sách hộp thoại chat (`ChatBox`), lưu vết tin nhắn cũ (`Message`), cập nhật trạng thái tin nhắn (đã đọc/chưa đọc).
- **Giao diện Web Client:** Giao diện web trực quan sẵn có trong thư mục `public/`.
- **Tài liệu API tự động (Swagger):** Tra cứu và kiểm thử các RESTful API dễ dàng tại `/api-docs`.
- **Kiểm thử tự động (Testing):** Tích hợp bộ unit test với **Jest** và **Supertest**.

---

## Công nghệ sử dụng (Tech Stack)

- **Backend:** Node.js (v18+), Express.js v5
- **Real-time Engine:** Socket.IO v4
- **Database & ORM:** MySQL / MariaDB, Prisma ORM v7
- **Authentication:** JSON Web Token (`jsonwebtoken`), `bcryptjs`
- **Documentation:** Swagger UI Express, Swagger JSDoc
- **Testing:** Jest, Supertest
- **Development Tools:** Nodemon, Dotenv

---

## Cấu trúc thư mục dự án

```text
messenger/
├── prisma/                  # Prisma Schema, Migrations & Seed data
│   ├── schema.prisma        # Định nghĩa các model (User, ChatBox, Message)
│   └── seed.js              # Script khởi tạo dữ liệu mẫu
├── public/                  # Web Client Static (HTML, CSS, JS)
├── src/
│   ├── api/                 # Tầng API: Controllers, Routes, Middlewares
│   ├── config/              # Cấu hình Prisma, Swagger, ...
│   ├── core/                # Tầng nghiệp vụ: Repositories & Services
│   ├── socket/              # Socket.IO Event Handlers
│   ├── app.js               # Khởi tạo Express App & Dependency Injection
│   └── server.js            # Khởi tạo HTTP Server & Socket Server
├── tests/                   # Thư mục kiểm thử (Unit / Integration tests)
├── .env                     # Biến môi trường
├── package.json
└── README.md
```

---

## Cài đặt & Khởi chạy

### 1. Phụ thuộc (Prerequisites)

- **Node.js** (Phiên bản 18 trở lên)
- **MySQL / MariaDB** đã được cài đặt và khởi chạy.

### 2. Cài đặt các gói phụ thuộc

```bash
npm install
```

### 3. Cấu hình biến môi trường (`.env`)

Tạo hoặc chỉnh sửa file `.env` tại thư mục gốc của dự án:

```env
PORT=3000
DATABASE_URL="mysql://root:password@localhost:3306/messenger_db?allowPublicKeyRetrieval=true"
JWT_SECRET="your_jwt_secret_key"
```

### 4. Khởi tạo Cơ sở dữ liệu (Database Migration & Seed)

Đẩy schema vào cơ sở dữ liệu và tạo dữ liệu mẫu:

```bash
# Đẩy schema lên database
npm run db:push

# Tạo dữ liệu mẫu (Seed)
npm run seed
```

### 5. Khởi chạy ứng dụng

- **Chế độ phát triển (Development):**
  ```bash
  npm run dev
  ```

- **Chế độ sản xuất (Production):**
  ```bash
  npm start
  ```

Sau khi khởi chạy thành công, truy cập:
- **Web Client:** [http://localhost:3000](http://localhost:3000)
- **Tài liệu Swagger API:** [http://localhost:3000/api-docs](http://localhost:3000/api-docs)

---

## Kiểm thử (Testing)

Chạy các bài unit test tự động bằng Jest:

```bash
npm test
```

---

## Danh sách REST API chính

| Phương thức | Endpoint | Mô tả | Yêu cầu Auth |
| :--- | :--- | :--- | :---: |
| **POST** | `/api/auth/register` | Đăng ký tài khoản mới | ❌ |
| **POST** | `/api/auth/login` | Đăng nhập hệ thống | ❌ |
| **GET** | `/api/users` | Lấy danh sách người dùng | ✅ |
| **GET** | `/api/messages/:chatBoxId` | Lấy lịch sử tin nhắn trong cuộc trò chuyện | ✅ |
| **POST** | `/api/messages` | Gửi tin nhắn mới qua HTTP API | ✅ |

*Xem chi tiết toàn bộ danh sách API và tham số tại giao diện `/api-docs`.*

---

## Đóng góp

Mọi đóng góp (Issue, Pull Request) đều được hoan nghênh. Vui lòng tạo issue trước khi tạo PR để thảo luận về thay đổi.

---

## Giấy phép (License)

Dự án phát hành theo giấy phép [ISC](LICENSE).
