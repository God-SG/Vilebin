import { getSessionUsername } from '../../middlewares/session.js';
import { getStatus, getId, getIP, checkCaptcha, sendTelegram, addLog } from '../../utils.js';

export default function (fastify) {
    fastify.post('/addProfileComment', async (request, reply) => {
        const { content, profileID, "cf-recaptcha-response": cf_recaptcha_response } = request.body;
        const sessionUser = await getSessionUsername(request);
        if (!sessionUser) return reply.code(400).send({ ok: false, error: "User not logged in." });

        if (!await checkCaptcha(cf_recaptcha_response)) {
            return reply.code(400).send({ ok: false, error: "Please complete the captcha." });
        }

        if (!content || content.length < 2 || content.length > 50) {
            return reply.code(400).send({ ok: false, error: "Content must be between 2 and 50 characters." });
        }

        const login = sessionUser;
        const loginf = sessionUser.toLowerCase();
        const ipAddress = await getIP(request);

        const [userRows] = await fastify.db.query(
            "SELECT username, comments FROM users WHERE id = ?",
            [profileID]
        );
        if (!userRows.length) return reply.code(404).send({ ok: false, error: "User not found." });

        const { username, comments: commentsRaw } = userRows[0];
        
        let comments = commentsRaw ? JSON.parse(commentsRaw) : [];
        if (!Array.isArray(comments)) comments = Object.values(comments);

        const now = new Date();

        const newComment = {
            login,
            date: new Date().toLocaleString('en-GB', { timeZone: 'Europe/Moscow', hour12: false }).split(', ').map((v,i) => i===0 ? v.split('/').reverse().join('-') : v).join(' '),
            comment: content,
            ip_address: ipAddress,
            deleted: false
        };
        comments.push(newComment);

        await fastify.db.query(
            "UPDATE users SET comments = ? WHERE id = ?",
            [JSON.stringify(comments), profileID]
        );
        await fastify.db.query(
            "INSERT INTO activity (username, type, link, date) VALUES (?, ?, ?, ?)",
            [loginf, "comment_profile", `/user/${username}`, now.toLocaleString('ru-RU', { hour12: false })]
        );

        const tgMessage = `<b>New Profile Comment!</b>\n\nProfile - <tg-spoiler>https://vilebin.net/user/${username}</tg-spoiler>\nUser - <b>${login}</b>\nComment - <b>${content}</b>`;
        setImmediate(() => sendTelegram("-1002881608552", tgMessage));

        await addLog(request, "user", `commented on profile "${username}": "${content}"`, loginf);

        return { ok: true };
    });

    fastify.post('/showProfileComment', async (req, reply) => {
        const { commentDate, profileID } = req.query;
        const sessionUser = await getSessionUsername(req);
        if (!sessionUser) return reply.status(403).send({ success: false, error: 'Unauthorized' });

        const sessionStatus = await getStatus(req, sessionUser);

        const [[userRow]] = await fastify.db.query(
            "SELECT comments FROM users WHERE id = ?",
            [profileID]
        );

        if (!userRow) return reply.status(404).send({ success: false, error: 'User not found.' });

        const sessionUserID = await getId(req, sessionUser);
        if (profileID != sessionUserID && !['admin', 'manager', 'mod'].includes(sessionStatus)) {
            return reply.status(403).send({ success: false, error: 'Unauthorized' });
        }

        const comments = userRow.comments ? JSON.parse(userRow.comments) : [];
        let updated = false;

        for (const comment of comments) {
            if (comment.date === commentDate) {
                comment.deleted = false;
                updated = true;
                break;
            }
        }

        if (!updated) return reply.status(403).send({ success: false, error: 'Comment not found or Unauthorized.' });

        await fastify.db.query(
            "UPDATE users SET comments = ? WHERE id = ?",
            [JSON.stringify(comments), profileID]
        );

        return { success: true };
    });

    fastify.post('/hideProfileComment', async (req, reply) => {
        const { commentDate, profileID } = req.query;
        const sessionUser = await getSessionUsername(req);
        if (!sessionUser) return reply.status(403).send({ success: false, error: 'Unauthorized' });

        const sessionStatus = await getStatus(req, sessionUser);

        const [[userRow]] = await fastify.db.query(
            "SELECT comments FROM users WHERE id = ?",
            [profileID]
        );

        if (!userRow) return reply.status(404).send({ success: false, error: 'User not found.' });

        const sessionUserID = await getId(req, sessionUser);
        if (profileID != sessionUserID && !['admin', 'manager', 'mod'].includes(sessionStatus)) {
            return reply.status(403).send({ success: false, error: 'Unauthorized' });
        }

        const comments = userRow.comments ? JSON.parse(userRow.comments) : [];
        let updated = false;

        for (const comment of comments) {
            if (comment.date === commentDate) {
                comment.deleted = true;
                updated = true;
                break;
            }
        }

        if (!updated) return reply.status(403).send({ success: false, error: 'Comment not found or Unauthorized.' });

        await fastify.db.query(
            "UPDATE users SET comments = ? WHERE id = ?",
            [JSON.stringify(comments), profileID]
        );

        return { success: true };
    });
}