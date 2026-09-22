const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Messenger Web API',
    version: '1.0.0',
    description: 'Tài liệu API hệ thống Messenger Web - Môn Kiến trúc Phần mềm',
    contact: {
      name: 'Messenger Team',
    },
  },
  servers: [
    {
      url: 'http://localhost:5000',
      description: 'Local Development Server',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Nhập JWT token theo định dạng: Bearer <token>',
      },
    },
    schemas: {
      RegisterRequest: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: {
            type: 'string',
            example: 'nguyenvana',
            description: 'Tên đăng nhập (3 - 30 ký tự, không chứa khoảng trắng)',
          },
          password: {
            type: 'string',
            example: '123456',
            description: 'Mật khẩu (tối thiểu 6 ký tự)',
          },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: {
            type: 'string',
            example: 'nguyenvana',
          },
          password: {
            type: 'string',
            example: '123456',
          },
        },
      },
      UserResponse: {
        type: 'object',
        properties: {
          id: {
            type: 'integer',
            example: 1,
          },
          username: {
            type: 'string',
            example: 'nguyenvana',
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            example: '2026-09-23T00:00:00.000Z',
          },
        },
      },
      AuthResponse: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            example: 'success',
          },
          message: {
            type: 'string',
            example: 'Đăng nhập thành công',
          },
          data: {
            type: 'object',
            properties: {
              token: {
                type: 'string',
                example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
              },
              user: {
                $ref: '#/components/schemas/UserResponse',
              },
            },
          },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            example: 'fail',
          },
          message: {
            type: 'string',
            example: 'Tên đăng nhập đã tồn tại trong hệ thống',
          },
        },
      },
    },
  },
  paths: {
    '/api/auth/register': {
      post: {
        summary: 'Đăng ký tài khoản người dùng mới',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/RegisterRequest',
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Đăng ký tài khoản thành công',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthResponse',
                },
              },
            },
          },
          400: {
            description: 'Dữ liệu yêu cầu không hợp lệ',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
          409: {
            description: 'Tên đăng nhập đã tồn tại',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/login': {
      post: {
        summary: 'Đăng nhập vào hệ thống',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/LoginRequest',
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Đăng nhập thành công',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthResponse',
                },
              },
            },
          },
          400: {
            description: 'Thiếu thông tin đăng nhập',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
          401: {
            description: 'Sai tên đăng nhập hoặc mật khẩu',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/me': {
      get: {
        summary: 'Lấy thông tin tài khoản đang đăng nhập',
        tags: ['Authentication'],
        security: [
          {
            BearerAuth: [],
          },
        ],
        responses: {
          200: {
            description: 'Lấy thông tin thành công',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: {
                      type: 'string',
                      example: 'success',
                    },
                    data: {
                      type: 'object',
                      properties: {
                        user: {
                          $ref: '#/components/schemas/UserResponse',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          401: {
            description: 'Chưa đăng nhập hoặc token không hợp lệ',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
        },
      },
    },
  },
};

module.exports = swaggerSpec;
