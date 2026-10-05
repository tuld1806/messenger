const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');

function createUserRouter(userController) {
  const router = express.Router();

  router.use(authMiddleware);

  /**
   * @openapi
   * /api/users/search:
   *   get:
   *     summary: Tìm kiếm danh sách người dùng để nhắn tin
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: q
   *         schema:
   *           type: string
   *         description: Từ khóa tìm kiếm (username hoặc tên)
   *     responses:
   *       200:
   *         description: Trả về danh sách người dùng phù hợp
   */
  router.get('/search', userController.searchUsers);

  /**
   * @openapi
   * /api/users/{id}:
   *   get:
   *     summary: Lấy chi tiết thông tin một người dùng theo ID
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Thông tin người dùng
   *       404:
   *         description: Không tìm thấy người dùng
   */
  router.get('/:id', userController.getUserById);

  return router;
}

module.exports = createUserRouter;
