const AuthService = require('../services/auth.service');

const defaultAuthService = new AuthService();

class AuthController {
  constructor(authService = defaultAuthService) {
    this.authService = authService;
  }

  /**
   * Endpoint đăng ký tài khoản mới: POST /api/auth/register
   */
  register = async (req, res, next) => {
    try {
      const { username, password } = req.body;
      const result = await this.authService.register({ username, password });
      return res.status(201).json({
        status: 'success',
        message: 'Đăng ký tài khoản thành công',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Endpoint đăng nhập tài khoản: POST /api/auth/login
   */
  login = async (req, res, next) => {
    try {
      const { username, password } = req.body;
      const result = await this.authService.login({ username, password });
      return res.status(200).json({
        status: 'success',
        message: 'Đăng nhập thành công',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Endpoint lấy thông tin tài khoản hiện tại: GET /api/auth/me
   */
  getMe = async (req, res, next) => {
    try {
      const userId = req.user.id;
      const user = await this.authService.getCurrentUser(userId);
      return res.status(200).json({
        status: 'success',
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  };
}

module.exports = AuthController;
