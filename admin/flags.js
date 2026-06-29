import { DateTime } from "luxon";

import { getSessionUsername } from '../middlewares/session.js'
import { getStatus, getColor } from '../utils.js'

export default function (fastify) {
    fastify.get('/flags', async (req, reply) => {
        const username = await getSessionUsername(req);
        if (!username) return reply.redirect('/home');

        const status = await getStatus(req, username);
        if (!['admin', 'manager', 'mod'].includes(status)) {
            return reply.redirect('/home');
        }

        const moscowOffset = 3 * 60 * 60 * 1000;
        const now = new Date(Date.now() + moscowOffset);
        const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

        const [flagsRows] = await fastify.db.query(`
            SELECT id, post, reason, reporter, date, moderator, checkdate, status
            FROM flags
        `);

        const reporters = new Set();
        const flags = [];

        for (const r of flagsRows) {
            if (r.reporter) reporters.add(r.reporter);

            let humanDate = r.date;

            if (r.date) {
                const dt = DateTime.fromJSDate(r.date, { zone: "Europe/Moscow" });
                const now = DateTime.now().setZone("Europe/Moscow");

                humanDate = dt.toRelative({ base: now, locale: "en" });
            }

            flags.push({
                id: r.id,
                post: r.post,
                reason: r.reason,
                reporter: r.reporter,
                reportercolor: null,
                date: humanDate,
                moderator: r.moderator,
                checkdate: r.checkdate,
                status: r.status
            });
        }

        const reporterColors = {};

        for (const reporter of reporters) {
            reporterColors[reporter] = await getColor(req, reporter);
        }

        flags.forEach(f => {
            f.reportercolor = reporterColors[f.reporter] || null;
        });

        const [councilRows] = await fastify.db.query(`
            SELECT username
            FROM users
            WHERE status = 'council'
        `);

        const councils = [];

        for (const row of councilRows) {
            const councilUser = row.username;

            const [totalRows] = await fastify.db.query(`
                SELECT COUNT(*) AS total
                FROM flags
                WHERE reporter = ?
            `,[councilUser]);

            const [deniedRows] = await fastify.db.query(`
                SELECT COUNT(*) AS denied
                FROM flags
                WHERE reporter = ?
                AND status = 'denied'
            `,[councilUser]);

            const [weekRows] = await fastify.db.query(`
                SELECT COUNT(*) AS week
                FROM flags
                WHERE reporter = ?
                AND date > DATE_SUB(NOW(), INTERVAL 7 DAY)
            `,[councilUser]);

            councils.push({
                username: councilUser,
                color: await getColor(req, councilUser),
                total: totalRows[0].total,
                denied: deniedRows[0].denied,
                week: weekRows[0].week
            });
        }

        const [modRows] = await fastify.db.query(`
            SELECT checkdate
            FROM flags
            WHERE moderator = ?
        `,[username]);

        let modFlags7Days = 0;

        for (const f of modRows) {

            if (!f.checkdate) continue;

            try {
                const dt = new Date(f.checkdate);
                if (dt > sevenDaysAgo) modFlags7Days++;
            } catch {}
        }

        return reply.view('admin/flags/index.html', {
            flags,
            mod_total: modRows.length,
            mod_flags_7_days: modFlags7Days,
            councils
        });
    });

    fastify.get('/flags/:id', async (req, reply) => {
        const flagID = parseInt(req.params.id);
        if (isNaN(flagID)) return reply.redirect('/admin/flags');

        const session_username = await getSessionUsername(req);
        if (!session_username) return reply.redirect('/home');

        const status = await getStatus(req, session_username);
        if (!['admin', 'founder','manager', 'mod'].includes(status)) {
            return reply.redirect('/home');
        }

        const moscowTZOffset = 3 * 60 * 60 * 1000;

        const [[flagRow]] = await fastify.db.query(
            "SELECT * FROM flags WHERE id = ? AND status = 'pending' LIMIT 1",
            [flagID]
        );
        if (!flagRow) return reply.redirect('/admin/flags');

        const flag = { ...flagRow };

        flag.dateFormatted = new Date(flag.date).toLocaleDateString(
            'en-US',
            { month: 'short', day: 'numeric', year: 'numeric' }
        );

        const [[pastRow]] = await fastify.db.query(
            `SELECT id, pastname, pastname_c, owner, view, pin, past, deleted, reactions, created_at
             FROM pastes
             WHERE pastname_c = ? LIMIT 1`,
            [flag.post_c]
        );
        if (!pastRow) return reply.redirect('/home');

        const past = { ...pastRow };

        let formattedDate;
        try {
            const d = new Date(past.created_at);
            formattedDate = new Date(d.getTime() + moscowTZOffset).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
        } catch {
            formattedDate = past.created_at.toString();
        }

        let [[nextFlag]] = await fastify.db.query(
            "SELECT id FROM flags WHERE id > ? AND status = 'pending' ORDER BY id ASC LIMIT 1",
            [flag.id]
        );
        if (!nextFlag) {
            [[nextFlag]] = await fastify.db.query(
                "SELECT id FROM flags WHERE status = 'pending' ORDER BY id ASC LIMIT 1"
            );
        }

        const [memoRow] = await fastify.db.query(
            "SELECT * FROM pastes_memos WHERE paste_id = ?",
            [past.id]
        );
        const activeMemo = memoRow.length > 0;

        if (flag.reporter) {
            flag.reportercolor = await getColor(req, flag.reporter);
        }

        return reply.view('admin/flags/check.html', {
            id: past.id,
            title: past.pastname,
            title_c: past.pastname_c,
            author: past.owner,
            authorstatus: await getStatus(req, past.owner),
            authorcolor: await getColor(req, past.owner),
            content: past.past,
            formatted_date: formattedDate,
            is_pinned: past.pin,
            flag,
            activeMemo,
            nextFlag: nextFlag.id
        });
    });
}