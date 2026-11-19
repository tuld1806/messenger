const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');

function createMediaRouter(mediaController) {
  const router = express.Router();

  router.use(authMiddleware);

  /**
   * @openapi
   * /api/media/presigned-url:
   *   post:
   *     summary: Cấp Pre-signed PUT URL để upload ảnh/video trực tiếp lên MinIO (tối đa 4 tệp, mỗi tệp <= 5MB)
   *     tags: [Media]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [chatBoxId, files]
   *             properties:
   *               chatBoxId:
   *                 type: integer
   *                 example: 1
   *               files:
   *                 type: array
   *                 maxItems: 4
   *                 items:
   *                   type: object
   *                   required: [fileName, mimeType, fileSize]
   *                   properties:
   *                     fileName:
   *                       type: string
   *                       example: photo.png
   *                     mimeType:
   *                       type: string
   *                       example: image/png
   *                     fileSize:
   *                       type: integer
   *                       example: 1048576
   *     responses:
   *       200:
   *         description: Danh sách kết quả Pre-signed PUT URL cho từng tệp (hiệu lực 300 giây)
   *       400:
   *         description: Dữ liệu tệp không hợp lệ hoặc vượt quá 4 tệp / 5MB
   *       403:
   *         description: Không có quyền truy cập phòng chat
   */
  router.post('/presigned-url', mediaController.createPresignedUrls);

  /**
   * @openapi
   * /api/media/view-url:
   *   get:
   *     summary: Cấp Pre-signed GET URL tạm thời (3600 giây) để xem ảnh/video trong phòng chat
   *     tags: [Media]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: chatBoxId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: query
   *         name: objectKey
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Trả về viewUrl có thời hạn 3600 giây
   *       403:
   *         description: Không có quyền xem tệp của cuộc trò chuyện khác
   */
  router.get('/view-url', mediaController.getViewUrl);

  /**
   * @openapi
   * /api/media/cleanup:
   *   post:
   *     summary: Xóa các tệp tạm chưa gắn với tin nhắn khi người dùng hủy chọn hoặc thoát phòng chat
   *     tags: [Media]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [chatBoxId, objectKeys]
   *             properties:
   *               chatBoxId:
   *                 type: integer
   *                 example: 1
   *               objectKeys:
   *                 type: array
   *                 items:
   *                   type: string
   *     responses:
   *       200:
   *         description: Kết quả dọn dẹp các tệp tạm
   */
  router.post('/cleanup', mediaController.cleanupTempFiles);

  return router;
}

module.exports = createMediaRouter;
