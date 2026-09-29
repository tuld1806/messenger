class UserService {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async searchUsers(query, excludeUserId) {
    if (!query || query.trim() === '') {
      return await this.userRepository.findAllExcept(excludeUserId);
    }
    return await this.userRepository.searchUsers(query.trim(), excludeUserId);
  }

  async getUserById(userId) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error('Không tìm thấy người dùng.');
    }
    return user;
  }
}

module.exports = UserService;
