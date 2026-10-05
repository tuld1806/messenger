class UserController {
  constructor(userService) {
    this.userService = userService;
  }

  searchUsers = async (req, res, next) => {
    try {
      const { q } = req.query;
      const users = await this.userService.searchUsers(q, req.user.id);
      return res.status(200).json({
        success: true,
        data: users,
      });
    } catch (error) {
      next(error);
    }
  };

  getUserById = async (req, res, next) => {
    try {
      const { id } = req.params;
      const user = await this.userService.getUserById(id);
      return res.status(200).json({
        success: true,
        data: user,
      });
    } catch (error) {
      next(error);
    }
  };
}

module.exports = UserController;
