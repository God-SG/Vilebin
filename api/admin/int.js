import { getSessionUsername } from '../../middlewares/session.js';
import { getStatus } from '../../utils.js';

export default function (fastify) {
    fastify.get('/int', async (req, reply) => {
        const username = await getSessionUsername(req);
        if (!username) {
            return reply.redirect('/home');
        }

        const status = await getStatus(req, username);
        if (!status || !['admin','founder', 'manager', 'mod', 'council'].includes(status)) {
            return reply.redirect('/home');
        }

        let flags = 0;
        let flagsLinks = [];
        let edits = 0;
        let editsLinks = [];
        let spam = 0;

        if (status !== 'council') {
   
            const [flagsRows] = await fastify.db.query(
                "SELECT id FROM flags WHERE status = 'pending'"
            );
            flags = flagsRows.length;
            if (flags > 0) {
                flagsLinks = flagsRows.map(row => `https://vilebin.cx/admin/flags/${row.id}`);
            }


            const [editsRows] = await fastify.db.query(
                "SELECT id FROM edits WHERE status = 'pending'"
            );
            edits = editsRows.length;
            if (edits > 0) {
                editsLinks = editsRows.map(row => `https://vilebin.cx/admin/edits/${row.id}`);
            }
        }


        const [spamRows] = await fastify.db.query(
            "SELECT COUNT(*) AS count FROM spam WHERE status = 'pending'"
        );
        spam = spamRows[0]?.count || 0;

        const total = (status === 'council' ? spam : (flags + edits + spam));

        return { 
            flags, 
            flagsLinks,
            edits, 
            editsLinks,
            spam, 
            total 
        };
    });
};