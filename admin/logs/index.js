import { getSessionUsername } from "../../middlewares/session.js";
import { getStatus } from "../../utils.js";

export default async function (fastify) {
    fastify.get('/logs', async (req, reply) => {
        const username = await getSessionUsername(req);
        if (!username) return reply.redirect('/home');

        const status = await getStatus(req, username);
        if (!status || !['admin','founder', 'manager'].includes(status)) return reply.redirect('/home');

        return reply.view('admin/logs/index.html');
    });
}