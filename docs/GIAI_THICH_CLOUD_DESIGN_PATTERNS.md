# TÀI LIỆU GIẢI THÍCH 4 CLOUD DESIGN PATTERNS
**(Dành cho Bảo vệ Bài tập lớn / Đồ án Môn học)**

> **Mục tiêu:** Giúp sinh viên nắm chắc bản chất, giải thích tự tin, ngắn gọn, đúng trọng tâm khi giảng viên hỏi về 4 mẫu thiết kế đám mây được áp dụng trong hệ thống Messenger.

---

## 1. Publisher - Subscriber (Pub/Sub) kết hợp Cache-Aside
*Đồng bộ Real-time & Quản lý người dùng online trên hệ thống phân tán*

### 📌 Vấn đề thực tế trong bài tập:
* Ban đầu, danh sách người dùng online được lưu trong RAM của máy chủ Node.js (`const onlineUsers = new Map()`).
* Khi mở rộng chạy từ 2 máy chủ trở lên (Cluster / Multi-instance), nếu User A kết nối vào Server 1 và User B kết nối vào Server 2, hai server này **không biết nhau**, dẫn đến tin nhắn bị mất và trạng thái online bị sai lệch.

### 💡 Cách hoạt động (Nguyên lý):
* **Pub/Sub (Redis Adapter):** Khi Server 1 nhận được tin nhắn gửi cho User B, thay vì tự tìm kiếm trong RAM, nó phát (Publish) tin nhắn vào một kênh chung trên Redis. Tất cả các server khác đang đăng ký (Subscribe) kênh này đều nhận được, và Server 2 sẽ chuyển tiếp tin nhắn đó đến User B.
* **Cache-Aside (Redis Key-Value):** Trạng thái online/offline không lưu ở RAM máy chủ nữa mà lưu tập trung trên Redis (`SET online:user_123`). Máy chủ chỉ đóng vai trò tra cứu nhanh.

### 🎯 Câu chốt ăn điểm khi báo cáo:
> *"Em dùng Redis Pub/Sub làm cầu nối truyền tin giữa các máy chủ Socket.IO và dùng Redis lưu trạng thái online tập trung, giúp hệ thống có thể mở rộng chạy nhiều máy chủ song song mà không sợ mất tin nhắn hay sai lệch người dùng online."*

---

## 2. Valet Key Pattern (Pre-signed URL)
*Tải tệp tin đa phương tiện trực tiếp lên Object Storage*

### 📌 Vấn đề thực tế trong bài tập:
* Người dùng gửi ảnh hoặc video dung lượng lớn qua chat.
* Nếu gửi file qua API Server (`Client -> Node.js -> Ổ cứng`), máy chủ sẽ bị **nghẽn mạng (băng thông)** và **tốn RAM/CPU** để hứng luồng byte dữ liệu, khiến các kết nối chat văn bản khác bị chậm hoặc treo.

### 💡 Cách hoạt động (Nguyên lý):
* Giống như việc bạn đưa chìa khóa phụ (Valet Key) cho nhân viên khách sạn tự đỗ xe giúp bạn:
  1. Client gửi yêu cầu: *"Tôi muốn tải lên 1 ảnh đại diện"*.
  2. Server Node.js tạo ra một đường dẫn bảo mật có thời hạn ngắn (Pre-signed URL, ví dụ hạn 5 phút) từ MinIO/S3 và trả về cho Client.
  3. Client dùng đường link đó **tải file thẳng lên MinIO**, hoàn toàn không đi qua máy chủ Node.js.

### 🎯 Câu chốt ăn điểm khi báo cáo:
> *"Mẫu Valet Key cho phép người dùng tải tệp tin trực tiếp lên kho lưu trữ MinIO qua Pre-signed URL bảo mật, giúp máy chủ Node.js tiết kiệm đến 90% băng thông và tài nguyên CPU vì không phải làm nhiệm vụ trung chuyển file."*

---

## 3. Queue-Based Load Leveling (Asynchronous Queue & CQRS)
*Khử nghẽn ghi cơ sở dữ liệu khi tải tăng đột biến*

### 📌 Vấn đề thực tế trong bài tập:
* Khi 2 người chat, mỗi tin nhắn gửi đi đều ép hệ thống phải thực hiện câu lệnh ghi `INSERT INTO Message` vào MariaDB ngay lập tức.
* Khi có nhiều người chat dồn dập (ví dụ giờ cao điểm hoặc gửi tin nhắn nhóm), số lượng kết nối ghi vượt quá giới hạn của MariaDB (Connection Pool Timeout), làm nghẽn hoặc sập cơ sở dữ liệu.

### 💡 Cách hoạt động (Nguyên lý):
* **Tách luồng đọc/ghi (CQRS) & Hàng đợi (Queue):**
  1. **Ưu tiên thời gian thực:** Khi có tin nhắn mới, Socket.IO gửi ngay lập tức tới người nhận qua WebSocket để người nhận thấy tin nhắn trong vòng vài chục mili-giây.
  2. **Làm phẳng tải ghi:** Đồng thời, tin nhắn được thả vào một hàng đợi (Message Queue / Redis Stream / BullMQ).
  3. **Tiến trình ngầm (Worker):** Một worker chạy ngầm sẽ rút từng tin nhắn từ hàng đợi ra ghi từ từ, tuần tự vào MariaDB.

### 🎯 Câu chốt ăn điểm khi báo cáo:
> *"Em áp dụng cơ chế hàng đợi bất đồng bộ để tách việc phát tin nhắn thời gian thực ra khỏi việc ghi vào cơ sở dữ liệu. Nhờ đó, dù có hàng nghìn tin nhắn dồn đến cùng lúc thì hàng đợi sẽ đóng vai trò như bể chứa đệm, giúp cơ sở dữ liệu không bao giờ bị quá tải."*

---

## 4. Rate Limiting & Circuit Breaker
*Kiểm soát lạm dụng và bảo vệ hệ thống khỏi sập dây chuyền*

### 📌 Vấn đề thực tế trong bài tập:
* **Spam:** Người dùng hoặc bot viết script spam hàng trăm tin nhắn mỗi giây làm đơ giao diện và tốn tài nguyên.
* **Lỗi dây chuyền (Cascading Failure):** Khi hệ thống tích hợp thêm một dịch vụ bên ngoài (ví dụ: dịch vụ Push Notification hoặc gửi Email xác nhận), nếu dịch vụ đó bị đơ/chậm, máy chủ của ta sẽ phải treo kết nối chờ đợi, kéo sập toàn bộ hệ thống.

### 💡 Cách hoạt động (Nguyên lý):
* **Rate Limiting (Bộ điều tiết lưu lượng):** Đặt ngưỡng giới hạn, ví dụ mỗi tài khoản chỉ được phát tối đa 5 tin nhắn/giây. Nếu vượt quá, từ chối ngay lập tức ở tầng mạng.
* **Circuit Breaker (Cầu dao tự ngắt):** Hoạt động hệt như chiếc cầu dao điện trong nhà. Nếu dịch vụ bên ngoài bị lỗi liên tiếp quá nhiều lần, cầu dao sẽ "bật mở" (OPEN) để ngắt kết nối ngay lập tức mà không chờ timeout, trả về phản hồi fallback an toàn và định kỳ tự động kiểm tra lại.

### 🎯 Câu chốt ăn điểm khi báo cáo:
> *"Rate Limiting giúp ngăn chặn tấn công spam tin nhắn, còn Circuit Breaker đóng vai trò như cầu dao điện ngắt kịp thời các dịch vụ chậm/lỗi bên thứ ba để bảo vệ máy chủ chính không bị sập dây chuyền."*

---

## 📋 BẢNG TỔNG KẾT NHANH (DÀNH CHO HỎI ĐÁP PHẢN XẠ)

| Pattern | Vấn đề giải quyết | Công nghệ dùng trong bài tập | Giá trị cốt lõi mang lại |
| :--- | :--- | :--- | :--- |
| **1. Pub/Sub & Cache-Aside** | Đa máy chủ không nhìn thấy nhau | Redis (Docker) | Mở rộng ngang (Horizontal Scaling) mượt mà |
| **2. Valet Key** | Nghẽn mạng & CPU khi upload file | MinIO (Docker) | Giải phóng băng thông máy chủ Node.js |
| **3. Queue-Based Load Leveling** | Sập Database khi chat dồn dập | Redis Streams / BullMQ | Bảo vệ DB, giảm độ trễ hiển thị tin nhắn |
| **4. Rate Limiting & Circuit Breaker**| Spam bot & Sập dây chuyền | Redis Token Bucket & Cầu dao | Tăng tính tự vệ và độ ổn định của hệ thống |
