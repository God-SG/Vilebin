import { getSessionUsername, clearSession } from './session.js'

export default function (fastify) {
    fastify.addHook('onRequest', async (req, reply) => {
        const session_username = await getSessionUsername(req);
        if (!session_username) return;

        const [[user]] = await fastify.db.query(
            'SELECT ban, banreason FROM users WHERE username = ?',
            [session_username]
        );

        if (!user) return;

        if (user.ban === true || user.ban === 1) {
            const reason = user.banreason;

            console.log(`JOIN BANNED USER | ${session_username} / ${reason || 'NO REASON'}`);

            await clearSession(req, reply);
            return reply.redirect('/', 403);
        };
    });
}