const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const AuthService = require('../src/services/auth.service');
const { verifyToken } = require('../src/utils/jwt');
const {
  BadRequestError,
  UnauthorizedError,
  ConflictError,
  NotFoundError,
} = require('../src/utils/errors');

// Mock UserRepository
class MockUserRepository {
  constructor() {
    this.users = [];
    this.currentId = 1;
  }

  async findByUsername(username) {
    return this.users.find((u) => u.username === username) || null;
  }

  async findById(id) {
    const user = this.users.find((u) => u.id === Number(id));
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      createdAt: user.createdAt,
    };
  }

  async existsByUsername(username) {
    return this.users.some((u) => u.username === username);
  }

  async create({ username, password }) {
    const newUser = {
      id: this.currentId++,
      username,
      password,
      createdAt: new Date(),
    };
    this.users.push(newUser);
    return newUser;
  }
}

describe('AuthService - Unit Tests', () => {
  describe('register()', () => {
    it('Đăng ký thành công và trả về token hợp lệ cùng thông tin user', async () => {
      const mockRepo = new MockUserRepository();
      const authService = new AuthService(mockRepo);

      const result = await authService.register({
        username: 'nguyenvana',
        password: 'password123',
      });

      assert.ok(result.token, 'Token phải tồn tại');
      assert.strictEqual(result.user.username, 'nguyenvana');
      assert.strictEqual(result.user.id, 1);
      assert.strictEqual(result.user.password, undefined, 'Không được trả về password');

      // Kiểm tra tính hợp lệ của token
      const decoded = verifyToken(result.token);
      assert.strictEqual(decoded.id, 1);
      assert.strictEqual(decoded.username, 'nguyenvana');
    });

    it('Ném lỗi BadRequestError khi username bị rỗng', async () => {
      const mockRepo = new MockUserRepository();
      const authService = new AuthService(mockRepo);

      await assert.rejects(
        async () => {
          await authService.register({ username: '', password: 'password123' });
        },
        (err) => {
          assert.ok(err instanceof BadRequestError);
          assert.match(err.message, /Tên đăng nhập không được để trống/);
          return true;
        }
      );
    });

    it('Ném lỗi BadRequestError khi username có khoảng trắng', async () => {
      const mockRepo = new MockUserRepository();
      const authService = new AuthService(mockRepo);

      await assert.rejects(
        async () => {
          await authService.register({ username: 'huy anh', password: 'password123' });
        },
        (err) => {
          assert.ok(err instanceof BadRequestError);
          assert.match(err.message, /không được chứa khoảng trắng/);
          return true;
        }
      );
    });

    it('Ném lỗi BadRequestError khi mật khẩu dưới 6 ký tự', async () => {
      const mockRepo = new MockUserRepository();
      const authService = new AuthService(mockRepo);

      await assert.rejects(
        async () => {
          await authService.register({ username: 'nguyenvana', password: '123' });
        },
        (err) => {
          assert.ok(err instanceof BadRequestError);
          assert.match(err.message, /tối thiểu 6 ký tự/);
          return true;
        }
      );
    });

    it('Ném lỗi ConflictError khi username đã tồn tại trong CSDL', async () => {
      const mockRepo = new MockUserRepository();
      const authService = new AuthService(mockRepo);

      // Đăng ký lần 1
      await authService.register({ username: 'nguyenvana', password: 'password123' });

      // Đăng ký lại cùng username
      await assert.rejects(
        async () => {
          await authService.register({ username: 'nguyenvana', password: 'anotherPassword' });
        },
        (err) => {
          assert.ok(err instanceof ConflictError);
          assert.match(err.message, /đã tồn tại/);
          return true;
        }
      );
    });
  });

  describe('login()', () => {
    it('Đăng nhập thành công với username và password chính xác', async () => {
      const mockRepo = new MockUserRepository();
      const authService = new AuthService(mockRepo);

      // Tạo sẵn user
      await authService.register({ username: 'nguyenvana', password: 'password123' });

      // Đăng nhập
      const result = await authService.login({ username: 'nguyenvana', password: 'password123' });

      assert.ok(result.token);
      assert.strictEqual(result.user.username, 'nguyenvana');
      assert.strictEqual(result.user.password, undefined);
    });

    it('Ném lỗi UnauthorizedError khi username không tồn tại', async () => {
      const mockRepo = new MockUserRepository();
      const authService = new AuthService(mockRepo);

      await assert.rejects(
        async () => {
          await authService.login({ username: 'notfound', password: 'password123' });
        },
        (err) => {
          assert.ok(err instanceof UnauthorizedError);
          assert.match(err.message, /không chính xác/);
          return true;
        }
      );
    });

    it('Ném lỗi UnauthorizedError khi sai mật khẩu', async () => {
      const mockRepo = new MockUserRepository();
      const authService = new AuthService(mockRepo);

      await authService.register({ username: 'nguyenvana', password: 'password123' });

      await assert.rejects(
        async () => {
          await authService.login({ username: 'nguyenvana', password: 'wrongPassword' });
        },
        (err) => {
          assert.ok(err instanceof UnauthorizedError);
          assert.match(err.message, /không chính xác/);
          return true;
        }
      );
    });
  });

  describe('getCurrentUser()', () => {
    it('Lấy thông tin người dùng theo ID thành công', async () => {
      const mockRepo = new MockUserRepository();
      const authService = new AuthService(mockRepo);

      const reg = await authService.register({ username: 'nguyenvana', password: 'password123' });
      const user = await authService.getCurrentUser(reg.user.id);

      assert.strictEqual(user.username, 'nguyenvana');
      assert.strictEqual(user.id, reg.user.id);
    });

    it('Ném lỗi NotFoundError khi không tìm thấy user ID', async () => {
      const mockRepo = new MockUserRepository();
      const authService = new AuthService(mockRepo);

      await assert.rejects(
        async () => {
          await authService.getCurrentUser(999);
        },
        (err) => {
          assert.ok(err instanceof NotFoundError);
          return true;
        }
      );
    });
  });
});
