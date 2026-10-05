const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');

function createAuthRouter(authController) {
  const router = express.Router();

  /**
   * @openapi
   * /api/auth/register:
   *   post:
   *     summary: Đăng ký tài khoản mới
   *     tags: [Authentication]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [username, password]
   *             properties:
   *               username:
   *                 type: string
   *                 example: tuandl
   *               password:
   *                 type: string
   *                 example: 123456
   *               name:
   *                 type: string
   *                 example: Đỗ Tấn Tuấn
   *               avatar:
   *                 type: string
   *                 example: https://api.dicebear.com/7.x/bottts/svg?seed=tuandl
   *     responses:
   *       201:
   *         description: Đăng ký thành công và trả về thông tin user + token JWT
   *       400:
   *         description: Lỗi dữ liệu đầu vào hoặc tài khoản đã tồn tại
   */
  router.post('/register', authController.register);

  /**
   * @openapi
   * /api/auth/login:
   *   post:
   *     summary: Đăng nhập hệ thống
   *     tags: [Authentication]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [username, password]
   *             properties:
   *               username:
   *                 type: string
   *                 example: tuandl
   *               password:
   *                 type: string
   *                 example: 123456
   *     responses:
   *       200:
   *         description: Đăng nhập thành công và trả về token JWT
   *       400:
   *         description: Sai thông tin đăng nhập
   */
  router.post('/login', authController.login);

  /**
   * @openapi
   * /api/auth/me:
   *   get:
   *     summary: Lấy thông tin cá nhân của người dùng hiện tại
   *     tags: [Authentication]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Trả về profile cá nhân
   *       401:
   *         description: Chưa xác thực hoặc Token không hợp lệ
   */
  router.get('/me', authMiddleware, authController.getMe);

  return router;
}

module.exports = createAuthRouter;
