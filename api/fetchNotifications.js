import { getSessionUsername } from '../middlewares/session.js';

export default function (fastify) {
  fastify.get('/fetchNotifications', async (req, reply) => {
    const sessionUsername = await getSessionUsername(req);
    if (!sessionUsername) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const fiveDaysAgo = Date.now() - 5 * 24 * 60 * 60 * 1000;

    const [rows] = await fastify.db.query(
      `SELECT message, \`read\`, date, danger
       FROM notifications
       WHERE username = ?
       ORDER BY id DESC`,
      [sessionUsername]
    );

    const notificationsList = rows
      .map(n => {
        let createdAt = null;
        if (n.date) {
          const timestamp = Date.parse(n.date);
          if (!isNaN(timestamp) && timestamp >= fiveDaysAgo) {
            createdAt = Math.floor(timestamp / 1000);
          }
        }
        return createdAt ? {
          message: n.message,
          status: n.read,
          createdAt,
          highlight: !!n.danger
        } : null;
      })
      .filter(Boolean);

    if (req.query.action === 'seen') {
      await fastify.db.query(
        "UPDATE notifications SET `read` = 'read' WHERE username = ?",
        [sessionUsername]
      );
    }

    return { notifications: notificationsList };
  });
}