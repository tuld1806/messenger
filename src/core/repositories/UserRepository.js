/**
 * User Repository Interface & Implementation for Data Access
 */
class UserRepository {
  constructor(prismaClient) {
    this.prisma = prismaClient;
  }

  async findByUsername(username) {
    return await this.prisma.user.findUnique({
      where: { username },
    });
  }

  async findById(id) {
    return await this.prisma.user.findUnique({
      where: { id: parseInt(id, 10) },
      select: {
        id: true,
        username: true,
        name: true,
        avatar: true,
        createdAt: true,
      },
    });
  }

  async create(userData) {
    return await this.prisma.user.create({
      data: userData,
      select: {
        id: true,
        username: true,
        name: true,
        avatar: true,
        createdAt: true,
      },
    });
  }

  async searchUsers(query, excludeUserId) {
    return await this.prisma.user.findMany({
      where: {
        NOT: { id: parseInt(excludeUserId, 10) },
        OR: [
          { username: { contains: query } },
          { name: { contains: query } },
        ],
      },
      select: {
        id: true,
        username: true,
        name: true,
        avatar: true,
      },
      take: 20,
    });
  }

  async findAllExcept(excludeUserId) {
    return await this.prisma.user.findMany({
      where: {
        NOT: { id: parseInt(excludeUserId, 10) },
      },
      select: {
        id: true,
        username: true,
        name: true,
        avatar: true,
      },
    });
  }
}

module.exports = UserRepository;
