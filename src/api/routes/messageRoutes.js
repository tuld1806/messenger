const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');

function createMessageRouter(messageController) {
  const router = express.Router();

  router.use(authMiddleware);

  /**
   * @openapi
   * /api/messages/conversations:
   *   get:
   *     summary: Lấy danh sách các cuộc trò chuyện gần đây của người dùng
   *     tags: [Messages]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Danh sách các cuộc trò chuyện đi kèm thông tin bạn chat và tin nhắn mới nhất
   */
  router.get('/conversations', messageController.getConversations);

  /**
   * @openapi
   * /api/messages/chatbox:
   *   post:
   *     summary: Tạo hoặc lấy phòng chat giữa người dùng hiện tại và người nhận
   *     tags: [Messages]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [recipientId]
   *             properties:
   *               recipientId:
   *                 type: integer
   *                 example: 2
   *     responses:
   *       200:
   *         description: Trả về thông tin phòng chat
   */
  router.post('/chatbox', messageController.createChatBox);

  /**
   * @openapi
   * /api/messages/history/{chatBoxId}:
   *   get:
   *     summary: Lấy lịch sử tin nhắn của một phòng chat
   *     tags: [Messages]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: chatBoxId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 50
   *       - in: query
   *         name: skip
   *         schema:
   *           type: integer
   *           default: 0
   *     responses:
   *       200:
   *         description: Lịch sử tin nhắn trong phòng chat
   */
  router.get('/history/:chatBoxId', messageController.getHistory);

  /**
   * @openapi
   * /api/messages/send:
   *   post:
   *     summary: Gửi tin nhắn mới tới người dùng hoặc vào phòng chat
   *     tags: [Messages]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [content]
   *             properties:
   *               chatBoxId:
   *                 type: integer
   *                 example: 1
   *               targetUserId:
   *                 type: integer
   *                 example: 2
   *               content:
   *                 type: string
   *                 example: Xin chào, bạn khỏe không?
   *     responses:
   *       201:
   *         description: Tin nhắn đã được tạo thành công
   */
  router.post('/send', messageController.sendMessage);

  return router;
}

module.exports = createMessageRouter;
