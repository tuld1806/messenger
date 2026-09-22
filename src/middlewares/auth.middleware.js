const { verifyToken } = require('../utils/jwt');
const { UnauthorizedError } = require('../utils/errors');

/**
 * Middleware xác thực JWT token từ Header Authorization: Bearer <token>
 */
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Vui lòng đăng nhập để tiếp tục (Thiếu token)');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new UnauthorizedError('Token không hợp lệ');
    }

    const decoded = verifyToken(token);
    req.user = decoded; // { id, username, iat, exp }
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return next(new UnauthorizedError('Token không hợp lệ'));
    }
    if (error.name === 'TokenExpiredError') {
      return next(new UnauthorizedError('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại'));
    }
    next(error);
  }
};

module.exports = authMiddleware;
