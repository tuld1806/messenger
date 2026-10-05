class AuthController {
  constructor(authService) {
    this.authService = authService;
  }

  register = async (req, res, next) => {
    try {
      const { username, password, name, avatar } = req.body;
      const result = await this.authService.register({ username, password, name, avatar });
      return res.status(201).json({
        success: true,
        message: 'Đăng ký tài khoản thành công.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  login = async (req, res, next) => {
    try {
      const { username, password } = req.body;
      const result = await this.authService.login({ username, password });
      return res.status(200).json({
        success: true,
        message: 'Đăng nhập thành công.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  getMe = async (req, res, next) => {
    try {
      const user = await this.authService.getUserProfile(req.user.id);
      return res.status(200).json({
        success: true,
        data: user,
      });
    } catch (error) {
      next(error);
    }
  };
}

module.exports = AuthController;
