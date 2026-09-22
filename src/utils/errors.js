class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

class BadRequestError extends AppError {
  constructor(message = 'Dữ liệu yêu cầu không hợp lệ') {
    super(message, 400);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Xác thực không thành công') {
    super(message, 401);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Bạn không có quyền thực hiện thao tác này') {
    super(message, 403);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Không tìm thấy tài nguyên') {
    super(message, 404);
  }
}

class ConflictError extends AppError {
  constructor(message = 'Dữ liệu đã tồn tại hoặc xảy ra xung đột') {
    super(message, 409);
  }
}

module.exports = {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
};
