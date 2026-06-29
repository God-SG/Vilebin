import speakeasy from 'speakeasy';

import { getTwofaSessionUsername, setSession, clearTwofaSession } from '../../middlewares/session.js';
import { addLog } from '../../utils.js';

export default function (fastify) {
    fastify.get('/auth/two', async (req, reply) => {
        const username = await getTwofaSessionUsername(req);
        if (!username) {
            return reply.status(401).send({ success: false, error: 'Unauthorized' });
        }

        const [rows] = await fastify.db.query(
            'SELECT totp_enabled, totp_secret FROM users WHERE username = ? LIMIT 1',
            [username]
        );

        if (!rows.length) {
            return reply.status(400).send({ success: false, error: 'User not found' });
        }

        const { totp_enabled, totp_secret } = rows[0];
        if (!totp_enabled) {
            return reply.status(400).send({ success: false, error: '2FA not enabled' });
        }
        if (!totp_secret) {
            return reply.status(400).send({ success: false, error: 'TOTP not initialized' });
        }

        const verified = speakeasy.totp.verify({
            secret: totp_secret,
            encoding: 'base32',
            token: req.query.otp,
            window: 1
        });

        if (verified) {
            await setSession(req, reply, username);
            await clearTwofaSession(req, reply);
            await addLog(req, 'user', 'two step authorization', username);
            return reply.redirect('/home');
        }

        return reply.status(400).send({ success: false, error: 'Invalid 2FA code' });
    });
}