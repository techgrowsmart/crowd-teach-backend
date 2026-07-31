const client = require("../config/db");
async function syncProfileImageToUsers(email, profileImage) {
  if (!email || !profileImage) return;
  try {
    const findUserQuery = "SELECT id FROM users WHERE email = ? ALLOW FILTERING";
    const userResult = await client.execute(findUserQuery, [email], { prepare: true });
    if (userResult.rowLength > 0) {
      const userId = userResult.rows[0].id;
      await client.execute(
        "UPDATE users SET profileimage = ? WHERE id = ?",
        [profileImage, userId],
        { prepare: true }
      );
    }
  } catch (error) {
    console.error("⚠️ Failed to sync profile image to users table:", error.message);
  }
}
module.exports = { syncProfileImageToUsers };
