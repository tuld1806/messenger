const { rateLimit } = require('express-rate-limit');

/**
 * Chống brute-force đăng nhập: tối đa 5 lần đăng nhập THẤT BẠI / 15 phút / IP.
 * Đăng nhập thành công không bị tính vào hạn mức.
 * Có thể chỉnh bằng biến môi trường LOGIN_RATE_LIMIT_MAX và LOGIN_RATE_LIMIT_WINDOW_MS.
 */
const loginLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Bạn đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.',
  },
});

module.exports = { loginLimiter };
