const bcrypt = require('bcryptjs');
const UserRepository = require('../repositories/user.repository');
const { generateToken } = require('../utils/jwt');
const {
  BadRequestError,
  UnauthorizedError,
  ConflictError,
  NotFoundError,
} = require('../utils/errors');

class AuthService {
  constructor(userRepository = new UserRepository()) {
    this.userRepository = userRepository;
  }

  /**
   * Đăng ký tài khoản mới
   * @param {object} param0 { username, password }
   * @returns {Promise<{ token: string, user: object }>}
   */
  async register({ username, password }) {
    // 1. Validate dữ liệu đầu vào
    if (!username || typeof username !== 'string') {
      throw new BadRequestError('Tên đăng nhập không được để trống');
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 3 || trimmedUsername.length > 30) {
      throw new BadRequestError('Tên đăng nhập phải có từ 3 đến 30 ký tự');
    }

    if (/\s/.test(trimmedUsername)) {
      throw new BadRequestError('Tên đăng nhập không được chứa khoảng trắng');
    }

    if (!password || typeof password !== 'string') {
      throw new BadRequestError('Mật khẩu không được để trống');
    }

    if (password.length < 6) {
      throw new BadRequestError('Mật khẩu phải có tối thiểu 6 ký tự');
    }

    // 2. Kiểm tra xem username đã tồn tại chưa
    const existingUser = await this.userRepository.existsByUsername(trimmedUsername);
    if (existingUser) {
      throw new ConflictError('Tên đăng nhập đã tồn tại trong hệ thống');
    }

    // 3. Băm mật khẩu bằng bcrypt
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // 4. Lưu User vào cơ sở dữ liệu
    const newUser = await this.userRepository.create({
      username: trimmedUsername,
      password: hashedPassword,
    });

    // 5. Sinh JWT token
    const token = generateToken({
      id: newUser.id,
      username: newUser.username,
    });

    // 6. Trả về response (không trả password)
    return {
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        createdAt: newUser.createdAt,
      },
    };
  }

  /**
   * Đăng nhập tài khoản
   * @param {object} param0 { username, password }
   * @returns {Promise<{ token: string, user: object }>}
   */
  async login({ username, password }) {
    // 1. Validate dữ liệu đầu vào
    if (!username || !password) {
      throw new BadRequestError('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu');
    }

    const trimmedUsername = username.trim();

    // 2. Tìm người dùng theo username
    const user = await this.userRepository.findByUsername(trimmedUsername);
    if (!user) {
      throw new UnauthorizedError('Tên đăng nhập hoặc mật khẩu không chính xác');
    }

    // 3. So khớp mật khẩu với hash trong CSDL
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Tên đăng nhập hoặc mật khẩu không chính xác');
    }

    // 4. Sinh JWT token
    const token = generateToken({
      id: user.id,
      username: user.username,
    });

    // 5. Trả về response (loại bỏ trường password)
    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt,
      },
    };
  }

  /**
   * Lấy thông tin tài khoản hiện tại từ token
   * @param {number} userId
   * @returns {Promise<object>}
   */
  async getCurrentUser(userId) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('Không tìm thấy người dùng');
    }
    return user;
  }
}

module.exports = AuthService;
