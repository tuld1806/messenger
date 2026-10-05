const errorMiddleware = (err, req, res, next) => {
  console.error('[Error Middleware]:', err.message || err);

  const statusCode = err.statusCode || 400;
  return res.status(statusCode).json({
    success: false,
    message: err.message || 'Lỗi hệ thống nội bộ.',
  });
};

module.exports = errorMiddleware;
