import * as config from '../config.js';
import { getSessionUsername } from '../middlewares/session.js';

export default function(fastify) {
    fastify.addHook('preHandler', async (req, reply) => {
        const sessionUsername = await getSessionUsername(req);
        let result;
        if (sessionUsername) {
            const [rows] = await fastify.db.query('SELECT * FROM users WHERE username = ?', [sessionUsername]);
            result = rows[0];
        }

        const originalView = reply.view.bind(reply);
        reply.view = (template, data = {}) => {
            return originalView(template, {
                request: req,
                path: req.url,
                styles: config.styles,
                ...(result?.username ? { username: result.username } : {}),
                ...(result?.status ? { status: result.status } : {}),
                ...(result?.color ? { color: result.color } : {}),
                ...data
            });
        };
    });
}