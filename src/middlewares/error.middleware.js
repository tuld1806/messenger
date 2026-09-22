const { AppError } = require('../utils/errors');

/**
 * Global Error Handling Middleware
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.statusCode = err.statusCode || 500;
  error.status = err.status || 'error';

  // Lỗi parse JSON không hợp lệ từ client
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    error.statusCode = 400;
    error.status = 'fail';
    error.message = 'Dữ liệu JSON gửi lên không hợp lệ';
  }

  // Lỗi Prisma: Trùng Unique Constraint (P2002)
  if (err.code === 'P2002') {
    error.statusCode = 409;
    error.status = 'fail';
    const fields = err.meta?.target ? ` (${err.meta.target})` : '';
    error.message = `Dữ liệu đã tồn tại trong hệ thống${fields}`;
  }

  // Ghi log lỗi máy chủ ra console nếu không phải lỗi nghiệp vụ thường
  if (error.statusCode >= 500) {
    console.error('Unhandled Internal Error:', err);
  }

  return res.status(error.statusCode).json({
    status: error.status,
    message: error.message || 'Đã có lỗi xảy ra phía máy chủ',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
