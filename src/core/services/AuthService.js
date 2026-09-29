const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_messenger_key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

class AuthService {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async register({ username, password, name, avatar }) {
    if (!username || !password) {
      throw new Error('Tên đăng nhập và mật khẩu không được để trống.');
    }

    if (username.length < 3) {
      throw new Error('Tên đăng nhập phải có ít nhất 3 ký tự.');
    }

    if (password.length < 6) {
      throw new Error('Mật khẩu phải có ít nhất 6 ký tự.');
    }

    const existingUser = await this.userRepository.findByUsername(username);
    if (existingUser) {
      throw new Error('Tên đăng nhập đã tồn tại.');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await this.userRepository.create({
      username,
      password: hashedPassword,
      name: name || username,
      avatar: avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`,
    });

    const token = this.generateToken(newUser);

    return {
      user: newUser,
      token,
    };
  }

  async login({ username, password }) {
    if (!username || !password) {
      throw new Error('Vui lòng nhập tên đăng nhập và mật khẩu.');
    }

    const user = await this.userRepository.findByUsername(username);
    if (!user) {
      throw new Error('Tên đăng nhập hoặc mật khẩu không chính xác.');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new Error('Tên đăng nhập hoặc mật khẩu không chính xác.');
    }

    const userWithoutPassword = {
      id: user.id,
      username: user.username,
      name: user.name,
      avatar: user.avatar,
      createdAt: user.createdAt,
    };

    const token = this.generateToken(userWithoutPassword);

    return {
      user: userWithoutPassword,
      token,
    };
  }

  generateToken(user) {
    return jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
  }

  verifyToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (err) {
      throw new Error('Token không hợp lệ hoặc đã hết hạn.');
    }
  }

  async getUserProfile(userId) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error('Người dùng không tồn tại.');
    }
    return user;
  }
}

module.exports = AuthService;
