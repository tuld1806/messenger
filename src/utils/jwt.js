const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'messenger-super-secret-key-2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Sinh token JWT chứa payload
 * @param {object} payload - Dữ liệu đưa vào token (ví dụ: { id, username })
 * @returns {string} token
 */
const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
};

/**
 * Kiểm tra và giải mã token JWT
 * @param {string} token
 * @returns {object} decoded payload
 */
const verifyToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};

module.exports = {
  generateToken,
  verifyToken,
};
