import { getStatusStyle } from '../../utils.js'

export default function (fastify) {
  fastify.get('/fetchFollowData', async (req, reply) => {
      const userID = req.query.userID;
      if (!userID) {
          return reply.status(400).send({ error: "User ID is required" });
      }

      const [userRows] = await fastify.db.query(
          "SELECT username, followers FROM users WHERE id = ?",
          [userID]
      );

      if (!userRows.length) {
          return reply.status(404).send({ error: "User not found" });
      }

      const { username: sessionUsername, followers: followersJson } = userRows[0];
      const followers = followersJson ? JSON.parse(followersJson.trim()) : {};

      const getUserDetails = async (username) => {
          const [rows] = await fastify.db.query(
              "SELECT username, status, color FROM users WHERE username = ?",
              [username]
          );
          if (rows.length) {
              const { username: uname, status, color } = rows[0];
              const style = await getStatusStyle(status);
              return { username: uname, status, color, ...style };
          }
          return null;
      };

      const followersDetails = [];
      for (const username of Object.keys(followers)) {
          const detail = await getUserDetails(username);
          if (detail) followersDetails.push(detail);
      }
      followersDetails.reverse();

      const [allUsers] = await fastify.db.query("SELECT username, followers FROM users");

      const followingDetails = [];
      for (const { username: otherUser, followers: otherFollowersJson } of allUsers) {
          if (otherFollowersJson) {
              const otherFollowers = JSON.parse(otherFollowersJson);
              if (otherFollowers[sessionUsername]) {
                  const info = await getUserDetails(otherUser);
                  if (info) followingDetails.push(info);
              }
          }
      }
      followingDetails.reverse();

      return { success: true, followers: followersDetails, following: followingDetails };
  });
}