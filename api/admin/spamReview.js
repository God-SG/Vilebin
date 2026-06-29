import { DateTime } from "luxon";
import { getSessionUsername } from '../../middlewares/session.js';
import { addLog, getStatus } from '../../utils.js';

const ALLOWED_ROLES = new Set(['admin', 'manager', 'mod', 'council']);
const VERDICT_MAP = {
    '1': { type: 'private', status: 'approved', logText: 'spam' },
    '0': { type: 'public', status: 'denied', logText: 'no spam' }
};

export default function (fastify) {
    fastify.get('/spamReview/:id', async (req, reply) => {
        const username = await getSessionUsername(req);
        if (!username) {
            return reply.send({ success: false });
        }

        const status = await getStatus(req, username);
        if (!ALLOWED_ROLES.has(status)) {
            return reply.send({ success: false });
        }

        const id = parseInt(req.params.id);
        const verdict = req.query.verdict;

        if (isNaN(id) || !VERDICT_MAP[verdict]) {
            return reply.send({ success: false });
        }

        const verdictData = VERDICT_MAP[verdict];
        const checkdate = DateTime.now().setZone('Europe/Moscow').toISO();

        const connection = await fastify.db.getConnection();
        
        try {
            await connection.beginTransaction();

            const [[spamRow]] = await connection.query(
                'SELECT post, post_c FROM spam WHERE id = ? FOR UPDATE',
                [id]
            );
            
            if (!spamRow) {
                await connection.rollback();
                return reply.send({ success: false });
            }

            await Promise.all([
                connection.query(
                    'UPDATE pastes SET type = ? WHERE pastname_c = ?',
                    [verdictData.type, spamRow.post_c]
                ),
                connection.query(
                    'UPDATE spam SET status = ?, moderator = ?, checkdate = ? WHERE id = ?',
                    [verdictData.status, username, checkdate, id]
                )
            ]);

            await connection.commit();
            
            addLog(req, "admin", `reviewed spam with title "${spamRow.post}" (verdict - ${verdictData.logText})`, username)
                .catch(err => fastify.log.error(err));
            
            return reply.send({ success: true });
        } catch (error) {
            await connection.rollback();
            fastify.log.error(error);
            return reply.send({ success: false });
        } finally {
            connection.release();
        }
    });
}