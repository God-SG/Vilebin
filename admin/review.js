import { DateTime } from "luxon";

import { getSessionUsername } from '../middlewares/session.js'
import { getStatus } from '../utils.js'

export default function (fastify) {
    fastify.get('/review', async (req, reply) => {
        const session_username = await getSessionUsername(req);
        if (!session_username) return reply.redirect('/home');

        const status = await getStatus(req, session_username);
        if (!['admin','founder', 'manager', 'mod', 'council'].includes(status)) {
            return reply.redirect('/home');
        }

        const [[spamRow]] = await fastify.db.query(`
            SELECT id, post, post_c, violation, confidence, reason, date
            FROM spam
            WHERE status = 'pending'
            ORDER BY date ASC
            LIMIT 1
        `);
        
        let redirect;
        if (!spamRow) {
            if (['admin', 'manager', 'mod'].includes(status)) {
                redirect = '/admin';
            } else {
                redirect = '/council';
            }

            return reply.redirect(redirect);
        }

        const [[pastRow]] = await fastify.db.query(`
            SELECT past
            FROM pastes
            WHERE pastname_c = ?
            LIMIT 1
        `, [spamRow.post_c]);

        let humanDate = spamRow.date;
        if (spamRow.date) {
            const dt = DateTime.fromJSDate(spamRow.date, { zone: 'Europe/Moscow' });
            const now = DateTime.now().setZone('Europe/Moscow');
            humanDate = dt.toRelative({ base: now, locale: 'en' });
        }

        return reply.view('admin/review.html', {
            id: spamRow.id,
            title: spamRow.post,
            title_c: spamRow.post_c,
            content: pastRow?.past ?? null,
            confidence: spamRow.confidence,
            reason: spamRow.reason,
            date: humanDate
        });
    });
}