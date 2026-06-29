import { getSessionUsername } from "../middlewares/session.js";
import { getStatus } from "../utils.js";

export default async function (fastify) {
    fastify.get('/settings', async (req, reply) => {
        const username = await getSessionUsername(req);
        if (!username) return reply.redirect('/home');

        const status = await getStatus(req, username);
        if (!status || !['admin'].includes(status)) {
            return reply.redirect('/home');
        }

        const [rows] = await fastify.db.query(`
            SELECT 
                r.*,
                u.status AS user_status,
                u.color AS user_color
            FROM redeems r
            LEFT JOIN users u ON u.username = r.creator
            ORDER BY r.id DESC
        `);

        const [[config]] = await fastify.db.query(`
            SELECT tech, apply FROM config LIMIT 1
        `);

        return reply.view('admin/settings.html', {
            gifts: rows,
            config
        });
    });
}