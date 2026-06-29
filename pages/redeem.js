import { getSessionUsername } from '../middlewares/session.js'
import { getColor } from '../utils.js'

export default async function (fastify) {
    fastify.get('/redeem/:id', async (req, reply) => {
        const { id } = req.params;

        const username = await getSessionUsername(req);

        const [[redeem]] = await fastify.db.query(`
            SELECT role, col FROM redeems WHERE name = ?
        `, [id]);

        if (!redeem) {
            return reply.redirect('/');
        }

        const color = await getColor(req, username);

        return reply.view('redeem.html', {
            color,
            redeem_id: id,
        });
    });
};