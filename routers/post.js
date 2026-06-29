import { DateTime } from "luxon";

import { getSessionUsername } from '../middlewares/session.js';
import { getStatus, getIP, getColor } from '../utils.js';
import { addLog } from '../utils.js';

const viewsPerIp = new Map();

export default function (fastify) {
    fastify.get('/upload/:pastname', async (req, reply) => {
        const pastname = req.params.pastname.replace(/\s/g, '');
        const password = req.query.password;
        const error = req.query.error;

        const [resultRows] = await fastify.db.query(
            `SELECT id, pastname, pastname_c, owner, created_at, view, pin, commentsstatus, past, deleted, reactions, type, password, edit
            FROM pastes
            WHERE pastname_c = ?`,
            [pastname]
        );
        const result = resultRows[0];
        if (!result) return reply.redirect('/home');

        const username = await getSessionUsername(req);
        const statusus = username ? await getStatus(req, username) : 'anonymous';
        const isStaff = ['admin', 'manager', 'mod'].includes(statusus);

        if (result.deleted && !isStaff) return reply.redirect('/home');
        if (result.type === 'private' && (username || '').toLowerCase() !== result.owner.toLowerCase() && !isStaff) {
            return reply.redirect('/home');
        }

        if (result.password && (password !== result.password) && !isStaff && (username || '').toLowerCase() !== result.owner.toLowerCase()) {
            return reply.view('upload/password.html', {
                incorrect: password ? true : false
            });
        }

        const content = result.past;
        const userIp = await getIP(req);

        if (!viewsPerIp.has(userIp)) viewsPerIp.set(userIp, new Set());
        if (!viewsPerIp.get(userIp).has(pastname)) {
            viewsPerIp.get(userIp).add(pastname);
            const newViews = (result.view || 0) + 1;
            await fastify.db.query(
                `UPDATE pastes SET view = ? WHERE pastname_c = ?`,
                [newViews, pastname]
            );
        }

        const [ownerRows] = await fastify.db.query(
            `SELECT status, username FROM users WHERE username = ?`,
            [result.owner]
        );
        const ownerData = ownerRows[0];

        const pasteId = result.id;

        const [commentRows] = await fastify.db.query(
            `SELECT pc.id, pc.owner, pc.content, pc.created_at, pc.deleted
            FROM pastes_comments pc
            WHERE pc.paste_id = ?`,
            [pasteId]
        );

        let comments = await Promise.all(commentRows.map(async c => {
            const login = c.owner;
            let loginstatus = 'anonymous';
            let logincolor = null;

            if (login) {
                const [rows] = await fastify.db.query(
                    `SELECT status FROM users WHERE username = ?`,
                    [login]
                );
                loginstatus = rows[0]?.status || 'anonymous';
                logincolor = await getColor(req, login);
            }

            let formatted_date;
            try {
                formatted_date = new Date(c.created_at)
                    .toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
            } catch {
                formatted_date = c.created_at;
            }

            return {
                login,
                id: c.id,
                comment: c.content,
                date: c.created_at,
                deleted: c.deleted,
                loginstatus,
                logincolor,
                formatted_date
            };
        }));

        if (!isStaff) {
            comments = comments.filter(c => c.deleted === 0);
        }


        comments.sort((a, b) => new Date(b.date) - new Date(a.date));
        const formattedDate = (() => {
            try {
                return new Date(result.created_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
            } catch {
                return result.created_at;
            }
        })();

        const reactions = (() => {
            try { return JSON.parse(result.reactions || '{}'); } catch { return {}; }
        })();
        const likes = Object.values(reactions).filter(v => v === 'like').length;
        const dislikes = Object.values(reactions).filter(v => v === 'dislike').length;

        const [editRows] = await fastify.db.query(`SELECT id FROM edits WHERE post_c = ? AND status = 'pending'`, [pastname]);
        const isEdit = editRows.length > 0;

        const [memoRows] = await fastify.db.query(`SELECT * FROM pastes_memos WHERE paste_id = ?`, [result.id]);
        const isActiveMemo = memoRows.length > 0;

        const params = [pasteId];
        let queryPrev = `SELECT pastname FROM pastes WHERE id > ?`;
        let queryNext = `SELECT pastname FROM pastes WHERE id < ?`;

        if (!isStaff) {
            queryPrev += ` AND deleted = 0 AND type = 'public'`;
            queryNext += ` AND deleted = 0 AND type = 'public'`;
        }

        queryPrev += ` ORDER BY id ASC LIMIT 1`;
        queryNext += ` ORDER BY id DESC LIMIT 1`;

        const [prevRows] = await fastify.db.query(queryPrev, params);
        const [nextRows] = await fastify.db.query(queryNext, params);
        const prevPaste = prevRows[0]?.pastname.replace(/\s/g, '') || null;
        const nextPaste = nextRows[0]?.pastname.replace(/\s/g, '') || null;

        const [flagsRows] = await fastify.db.query(
            `SELECT * FROM flags WHERE post = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`,
            [result.pastname]
        );
        let flag = flagsRows[0] || null;

        const [deletionLogRows] = await fastify.db.query(
            `SELECT login, deys, date
            FROM logs
            WHERE deys LIKE ? AND deys LIKE ?
            ORDER BY id DESC
            LIMIT 1`,
            [`%deleting paste%`, `%${result.pastname}%`]
        );
        const deletion_log = deletionLogRows[0] || null;
        let deletion_info = null;

        if (deletion_log) {
            const text = deletion_log.deys;
console.log('RAW TEXT:', deletion_log.deys);
            const reasonMatch = text.match(/for reason "([^"]+)"/);
            let reason = reasonMatch?.[1] || null;

            if (reason) {
                reason = reason.replace(/\s*\(silent - (True|False)\)/g, '').trim();
                reason = reason.replace(/\s*\(flag by [^)]+\)/g, '').trim();
            }
            const silentMatch = text.match(/\(silent - (True|False)\)/);
            const flagMatch = text.match(/\(flag by ([^) -]+)/);

            const login = deletion_log.login;

            deletion_info = {
                by: login,
                status: await getStatus(req, login),
                color: await getColor(req, login),
                reason: reasonMatch?.[1] || null,
                time: new Date(deletion_log.date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                }),
                flag: {
                    by: flagMatch?.[1] || null
                },
                silent: silentMatch?.[1] || null
            };
        }

        return reply.view('upload/index.html', {
            id: result.id,
            pastname: result.pastname,
            pastname_c: result.pastname_c,
            owner: {
                login: ownerData?.username || 'Anonymous',
                status: ownerData?.status || 'anonymous',
                color: await getColor(req, result.owner)
            },
            content: content,
            formatted_date: formattedDate,
            views: result.view,
            is_pinned: result.pin,
            is_edit: result.edit,
            comments,
            commentsstatus: result.commentsstatus,
            delete: result.deleted,
            likes,
            dislikes,
            edit: isEdit,
            type: result.type,
            password: result.password,
            activeMemo: isActiveMemo,
            prev_paste: prevPaste,
            next_paste: nextPaste,
            flag: flag,
            seal: deletion_info,
            error
        });
    });

    fastify.get('/upload/:pastname/edit', async (req, reply) => {
        const pastname = req.params.pastname.replace(/\s/g, '');
        const username = await getSessionUsername(req);
        const status = await getStatus(req, username);
        const isStaff = ['admin', 'manager', 'mod'].includes(status);

        const [rows] = await fastify.db.query(
            `SELECT p.id, p.pastname, p.pastname_c, p.owner, p.created_at, p.view, p.pin,
                    p.commentsstatus, p.past, p.deleted, p.edit,
                    u.status AS owner_status
             FROM pastes p
             LEFT JOIN users u ON u.username = p.owner
             WHERE p.pastname_c = ?`,
            [pastname]
        );
        const paste = rows[0];
        if (!paste) return reply.redirect('/home');

        if (!paste.edit) return reply.redirect(`/upload/${req.params.pastname}`);
        if (paste.deleted && !isStaff) return reply.redirect('/home');
        if ((username || '').toLowerCase() !== paste.owner.toLowerCase() && !isStaff) return reply.redirect(`/upload/${req.params.pastname}`);

        const [editRows] = await fastify.db.query(
            `SELECT id FROM edits WHERE post_c = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`,
            [pastname]
        );
        if (editRows.length > 0) return reply.redirect(`/upload/${req.params.pastname}`, 303);

        let userData = null;
        if (username) {
            const [userRows] = await fastify.db.query(
                `SELECT status FROM users WHERE username = ?`,
                [username]
            );
            userData = userRows[0];
        }

        let formattedDate;
        try {
            formattedDate = new Date(paste.created_at)
                .toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
        } catch {
            formattedDate = paste.created_at;
        }

        const [commentRows] = await fastify.db.query(
            `SELECT pc.id, pc.owner, pc.content, pc.created_at, pc.deleted
             FROM pastes_comments pc
             WHERE pc.paste_id = ?`,
            [paste.id]
        );

        let comments = await Promise.all(commentRows.map(async c => {
            const login = c.owner;
            let loginstatus = 'anonymous';
            let logincolor = null;

            if (login) {
                const [rows] = await fastify.db.query(
                    `SELECT status FROM users WHERE username = ?`,
                    [login]
                );
                loginstatus = rows[0]?.status || 'anonymous';
                logincolor = await getColor(req, login);
            }

            let formatted_comment_date;
            try {
                formatted_comment_date = new Date(c.created_at)
                    .toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
            } catch {
                formatted_comment_date = c.created_at;
            }

            return {
                login,
                id: c.id,
                comment: c.content,
                date: c.created_at,
                deleted: c.deleted,
                loginstatus,
                logincolor,
                formatted_date: formatted_comment_date
            };
        }));

        if (!isStaff) comments = comments.filter(c => c.deleted === 0);

        comments.sort((a, b) => new Date(b.date) - new Date(a.date));

        return reply.view('upload/edit.html', {
            id: paste.id,
            pastname: paste.pastname,
            pastname_c: paste.pastname_c,
            owner: {
                login: paste.owner,
                status: paste.owner_status,
                color: await getColor(req, paste.owner)
            },
            content: paste.past,
            formatted_date: formattedDate,
            view: paste.view,
            username,
            commentsstatus: paste.commentsstatus,
            comments
        });
    });
    fastify.get('/upload/:file/canceledit', async (req, reply) => {
        const file = req.params.file;
        const username = await getSessionUsername(req);
        if (!username) return reply.redirect(`/home`);

        const [[editRow]] = await fastify.db.query(
            "SELECT editor, reason, newcontent, status FROM edits WHERE post_c = ? ORDER BY id DESC LIMIT 1",
            [file]
        );
        if (!editRow || editRow.status !== 'pending') return reply.redirect(`/upload/${file}`);

        const [[pasteRow]] = await fastify.db.query(
            "SELECT owner FROM pastes WHERE pastname_c = ? LIMIT 1",
            [file]
        );
        if (!pasteRow || pasteRow.owner !== username) return reply.redirect(`/upload/${file}`);

        const currentTime = DateTime.now().setZone('Europe/Moscow').toSQL({ includeOffset: false });

        await fastify.db.query(
            "UPDATE edits SET status = 'cancelled', moderator = ?, checkdate = ? WHERE post_c = ?",
            [username, currentTime, file]
        );

        await addLog(req, 'user', `cancel edit for paste "${file}"`, username);

        return reply.redirect(`/upload/${file}`);
    });

    fastify.get('/upload/:pastname/raw', async (req, reply) => {
        const pastname = req.params.pastname;
        const password = req.query.password || null;

        const username = await getSessionUsername(req);
        const status = await getStatus(req, username);

        const [rows] = await fastify.db.query(`
            SELECT id, pastname, pastname_c owner,
                past, deleted,
                type, password
            FROM pastes
            WHERE pastname_c = ?
            LIMIT 1
        `, [pastname])

        const result = rows[0]

        if (!result) {
            return reply.redirect('/home');
        }

        const isStaff = ['admin','manager','mod'].includes(status);
        const usernameLower = (username || '').toLowerCase();
        const ownerLower = (result.owner || '').toLowerCase();

        if (usernameLower !== ownerLower && result.type === 'private' && !isStaff) {
            return reply.redirect('/home');
        }

        if (usernameLower !== ownerLower && result.password !== null && !password && !isStaff) {
            return reply.redirect('/home');
        }

        if (result.password !== null && password && result.password !== password && !isStaff) {
            return reply.redirect('/home');
        }
        
        return reply.header('Content-Type', 'text/plain; charset=utf-8').send(result.past);
    });

    fastify.post('/upload/:pastname/add_comment', async (req, reply) => {
        const { pastname } = req.params
        const { comment, password } = req.body

        const pastnameUrl = pastname.replace(/ /g, '')

        const username = await getSessionUsername(req)
        const login = username || "Anonymous"
        const loginf = username || "anonymous"
        const ipAddress = await getIP(req)

        const status = await getStatus(req, username)

        const [rows] = await fastify.db.query(
            `SELECT id, owner, pin, commentsstatus, type, password
            FROM pastes
            WHERE pastname_c = ?`,
        [pastnameUrl]);

        const result = rows[0]

        if (!result) {
            return reply.status(404).send({ error: "Paste not found" })
        }

        const { id: pasteId, owner, commentsstatus, type, password: passwordDb } = result

        if ((username || '').toLowerCase() !== owner.toLowerCase() && type === 'private' && !['admin',  'manager', 'mod'].includes(status)) {
            return reply.redirect('/home')
        }

        if ((username || '').toLowerCase() !== owner.toLowerCase() && passwordDb && !password && !['admin',  'manager', 'mod'].includes(status)) {
            return reply.redirect('/home')
        }

        if (passwordDb && password && passwordDb !== password && !['admin',  'manager', 'mod'].includes(status)) {
            return reply.redirect('/home')
        }

        if (!commentsstatus) {
            return reply.redirect(`/upload/${pastnameUrl}`)
        }

        const now = new Date()

        const [lastCommentRows] = await fastify.db.query(
            `SELECT created_at
            FROM pastes_comments
            WHERE paste_id = ? AND ip_address = ?
            ORDER BY created_at DESC
            LIMIT 1`,
        [pasteId, ipAddress]);

        if (lastCommentRows.length && !['admin',  'manager', 'mod'].includes(status)) {
            const last = new Date(lastCommentRows[0].created_at)
            const diff = (now - last) / 1000

            if (diff < 100) {
                const wait = Math.floor(100 - diff)
                return reply.redirect(`/upload/${pastnameUrl}?error=Cooldown! Please wait ${wait} seconds.`)
            }
        }

        await fastify.db.query(`
            INSERT INTO pastes_comments
            (paste_id, owner, content, ip_address, created_at)
            VALUES (?, ?, ?, ?, ?)
            `,
        [pasteId, login, comment, ipAddress, now]);

        const tgMessage = `<b>New Comment!</b>

Paste - <tg-spoiler>https://vilebin.net/upload/${pastnameUrl}</tg-spoiler>
User - <b>${login}</b>
Comment - <b>${comment}</b>`
        fastify.sendTelegram?.("-1002881608552", tgMessage)

        await fastify.db.query(
            `INSERT INTO activity (username, type, link, date)
            VALUES (?, ?, ?, ?)`,
        [loginf, "comment_added", `/upload/${pastnameUrl}`, now.toISOString().slice(0, 19).replace('T', ' ')])

        return reply.redirect(`/upload/${pastnameUrl}`)
    });

    // ---------------- TOGGLE PIN ----------------
    fastify.post('/toggle_pinned/:paste', async (req, reply) => {
        const username = await getSessionUsername(req)
        if (!username) return reply.redirect(`/home`)

        const userstatus = await getStatus(req, username)
        if (!userstatus || !['admin',  'manager'].includes(userstatus)) {
            return reply.redirect(`/home`)
        }

        const paste = req.params.paste;

        const [[result]] = await fastify.db.query(
            'SELECT pin, pastname FROM pastes WHERE pastname_c = ?',
            [paste]
        )

        if (result) {
            const currentStatus = !!result.pin
            const newStatus = !currentStatus
            const actionType = currentStatus ? 'unpin' : 'pin'

            await fastify.db.query(
                'UPDATE pastes SET pin = ? WHERE pastname_c = ?',
                [newStatus, paste]
            )

            await addLog(req, 'admin', `${actionType} paste "${result.pastname}"`, username)
        }

        return reply.redirect(`/upload/${paste}`)
    })
    // ---------------- FULL SEAL ----------------
    fastify.post('/full_seal/:paste', async (req, reply) => {
        const username = await getSessionUsername(req)
        if (!username) return reply.redirect(`/home`)

        if (username !== 'Admin') return reply.redirect(`/home`)

        const userstatus = await getStatus(req, username)
        if (!userstatus || userstatus !== 'admin') return reply.redirect(`/home`)

        const paste = req.params.paste;

        const [[result]] = await fastify.db.query(
            'SELECT pastname FROM pastes WHERE pastname_c = ?',
            [paste]
        )

        if (result) {
            await fastify.db.query(
                'DELETE FROM pastes WHERE pastname_c = ?',
                [paste]
            )
            await addLog(req, 'admin', `fully deleting paste "${result.pastname}"`, username)
        }

        return reply.redirect(`/home`)
    })
    // ---------------- TOGGLE COMMENTS ----------------
    fastify.post('/toggle_comments/:paste', async (req, reply) => {
        const username = await getSessionUsername(req)
        if (!username) return reply.redirect(`/home`)

        const userstatus = await getStatus(req, username)
        if (!userstatus || !['admin',  'manager'].includes(userstatus)) {
            return reply.redirect(`/home`)
        }

        const paste = req.params.paste;

        const [[result]] = await fastify.db.query(
            'SELECT commentsstatus, pastname FROM pastes WHERE pastname_c = ?',
            [paste]
        )

        if (result) {
            const currentStatus = !!result.commentsstatus
            const newStatus = !currentStatus
            const actionType = currentStatus ? 'off' : 'on'

            await fastify.db.query(
                'UPDATE pastes SET commentsstatus = ? WHERE pastname_c = ?',
                [newStatus, paste]
            )

            await addLog(req, 'admin', `${actionType} comments on paste "${result.pastname}"`, username)
        }

        return reply.redirect(`/upload/${paste}`)
    })
    // ---------------- TOGGLE EDIT ----------------
    fastify.post('/toggle_edit/:paste', async (req, reply) => {
        const username = await getSessionUsername(req)
        if (!username) return reply.redirect(`/home`)

        const userstatus = await getStatus(req, username)
        if (!userstatus || !['admin',  'manager'].includes(userstatus)) {
            return reply.redirect(`/home`)
        }

        const paste = req.params.paste;

        const [[result]] = await fastify.db.query(
            'SELECT edit, pastname FROM pastes WHERE pastname_c = ?',
            [paste]
        )

        if (result) {
            const currentStatus = !!result.edit
            const newStatus = !currentStatus
            const actionType = currentStatus ? 'disable edit' : 'enable edit'

            await fastify.db.query(
                'UPDATE pastes SET edit = ? WHERE pastname_c = ?',
                [newStatus, paste]
            )

            await addLog(req, 'admin', `${actionType} for paste "${result.pastname}"`, username)
        }

        return reply.redirect(`/upload/${paste}`)
    })
}