import { getSessionUsername } from '../../middlewares/session.js'
import { getStatus } from '../../utils.js'

export default function (fastify) {
    fastify.get('/editPasteVisibility', async (req, reply) => {
        const username = await getSessionUsername(req);

        if (!username) {
            return reply.code(401).send({
                success: false,
                error: 'Unauthorized'
            });
        }

        const paste_id = req.query.pasteID;
        const new_type = req.query.type;
        let password = req.query.password || '';

        if (!paste_id || !new_type) {
            return reply.code(400).send({
                success: false,
                error: 'Missing required parameters'
            });
        }

        if (!['public', 'unlisted', 'private'].includes(new_type)) {
            return reply.code(400).send({
                success: false,
                error: 'Invalid visibility type'
            });
        }

        const [rows] = await fastify.db.query(
            'SELECT owner FROM pastes WHERE id = ?',
            [paste_id]
        );

        const paste = rows[0];

        if (!paste) {
            return reply.code(404).send({
                success: false,
                error: 'Paste not found'
            });
        }

        const paste_owner = paste.owner;

        const session_status = await getStatus(req, username);

        const allowed_status = [
            'admin','manager','mod','council', 'clique','companion','rich','criminal'
        ];

        if (paste_owner !== username && !allowed_status.includes(session_status) && !session_status.includes['admin', 'manager', 'mod']) {
            return reply.code(403).send({
                success: false,
                error: 'Access denied'
            });
        }

        if (
            password &&
            password !== '' &&
            !['admin','manager','mod','council','clique','companion','rich'].includes(session_status)
        ) {
            return reply.send({
                success: false,
                error: 'Access denied'
            });
        }

        if (password === '') {
            password = null;
        }

        await fastify.db.query(
            'UPDATE pastes SET type = ?, password = ? WHERE id = ?',
            [new_type, password, paste_id]
        );

        return reply.code(200).send({
            success: true
        });
    });
}