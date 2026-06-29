import { getSessionUsername } from '../../middlewares/session.js'
import { addLog, getStatus, sendTelegram } from '../../utils.js'

export default async function (fastify) {
    fastify.get('/reviewFlag', async (req, reply) => {
        const { flagID, verdict, reason, notify } = req.query;

        const username = await getSessionUsername(req);
        if (!username) return reply.send({ success: false, error: 'Unauthorized' });

        const status = await getStatus(req, username);

        if (!status || !["admin","manager","mod"].includes(status)) return reply.send({ success: false, error: 'Unauthorized' });

        const [[flag]] = await fastify.db.query(`
            SELECT id, post_c, reporter, reason, status
            FROM flags
            WHERE id = ?
        `,[flagID]);

        if (!flag) {
            return reply.send({ success: false, error: "Flag not found" });
        }

        const now = new Date().toLocaleString('sv-SE', {timeZone: 'Europe/Moscow', hour12: false}).replace(',', '');

        // DECLINE
        if (Number(verdict) === 0) {

            await fastify.db.query(
                "UPDATE flags SET status='denied', moderator=?, checkdate=? WHERE id=?",
                [username, now, flagID]
            );

            return reply.send({ success: true });
        }


        // APPROVE
        if (Number(verdict) === 1) {

            await fastify.db.query(
                "UPDATE flags SET status='approved', moderator=?, checkdate=? WHERE id=?",
                [username, now, flagID]
            );

            const [[paste]] = await fastify.db.query(
                "SELECT id, pastname, owner FROM pastes WHERE pastname_c=?",
                [flag.post_c]
            );

            if (!paste) {
                return reply.send({ success: false, error: "Paste not found" });
            }

            await fastify.db.query(
                "UPDATE pastes SET deleted=1 WHERE id=?",
                [paste.id]
            );

            await addLog(req, "admin", `deleting paste "${paste.pastname}" for reason "${reason}" (silent - ${notify ? 'True' : 'False'}) (flag by ${flag.reporter} - ${flag.reason})`, username);

            if (notify && paste.owner && paste.owner !== "Anonymous") {

                await fastify.db.query(`
                    INSERT INTO notifications (username,message,date,danger)
                    VALUES (?,?,?,?)
                `,[
                    paste.owner,
                    `Your paste - "${paste.pastname}" was deleted for the reason: "${reason}".`,
                    now,
                    1
                ]);

            }

            const file_url = paste.pastname.replace(/\s+/g,'');

            const tg_message =
`<b>Paste Deletion (flag - ${flag.reporter})!</b>

Paste - <tg-spoiler>https://vilebin.net/upload/${file_url}</tg-spoiler>
Admin - <b>${username}</b>
Correct Reason - <b>${reason}</b>
Flag Reason - <b>${flag.reason}</b>`;

            sendTelegram("-1002881608552", tg_message);

            return reply.send({ success: true });
        }

        return reply.send({ success: false });
    });
}