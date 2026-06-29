import { getSessionUsername } from './session.js'
import { getStatus } from '../utils.js'

export default function (fastify) {
    fastify.addHook('onRequest', async (req, reply) => {
        if (req.url.startsWith('/api/cf-health')) return;

        const session_username = await getSessionUsername(req);
        const session_status = await getStatus(req, session_username);

        const [[tech_result]] = await fastify.db.query(
            'SELECT tech FROM config LIMIT 1'
        );

        if (tech_result && (tech_result.tech === true || tech_result.tech === 1)) {
            if (!['admin'].includes(session_status)) {
                return reply.code(404).send({ error: 'Technical Works / Технические Работы' });
            };
        };
    });
}