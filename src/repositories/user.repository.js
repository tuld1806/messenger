const defaultPrisma = require('../config/prisma');

class UserRepository {
  constructor(prisma = defaultPrisma) {
    this.prisma = prisma;
  }

  /**
   * Tìm người dùng theo username
   * @param {string} username
   * @returns {Promise<object|null>}
   */
  async findByUsername(username) {
    return this.prisma.user.findUnique({
      where: { username },
    });
  }

  /**
   * Tìm người dùng theo ID
   * @param {number} id
   * @returns {Promise<object|null>}
   */
  async findById(id) {
    return this.prisma.user.findUnique({
      where: { id: Number(id) },
      select: {
        id: true,
        username: true,
        createdAt: true,
      },
    });
  }

  /**
   * Kiểm tra username đã tồn tại hay chưa
   * @param {string} username
   * @returns {Promise<boolean>}
   */
  async existsByUsername(username) {
    const count = await this.prisma.user.count({
      where: { username },
    });
    return count > 0;
  }

  /**
   * Tạo người dùng mới
   * @param {object} data { username, password }
   * @returns {Promise<object>}
   */
  async create({ username, password }) {
    return this.prisma.user.create({
      data: {
        username,
        password,
      },
    });
  }
}

module.exports = UserRepository;
