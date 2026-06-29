import { getSessionUsername } from '../../middlewares/session.js';

export default function (fastify) {
    fastify.get('/checkUsername', async (req, reply) => {
        let { username } = req.query;

        const sessionUsername = await getSessionUsername(req);

        if (username === sessionUsername) {
            return { available: true };
        }

        if (!username || username.trim().length === 0) {
            return { available: false };
        }

        username = username.trim();

        if (!/^[A-Za-z0-9_]{1,20}$/.test(username)) {
            return { available: false };
        }

        const [rows] = await fastify.db.query(
            'SELECT username FROM users WHERE username = ? LIMIT 1',
            [username]
        );

        if (rows.length) {
            return { available: false };
        }

        return { available: true };
    });
}