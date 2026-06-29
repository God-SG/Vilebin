import { DateTime } from "luxon";
import { getSessionUsername } from '../../middlewares/session.js';
import { getStatus } from '../../utils.js';

export default function (fastify) {
    fastify.get('/logs/flags', async (req, reply) => {
        const username = await getSessionUsername(req);
        if (!username) return reply.redirect('/home');

        const status = await getStatus(req, username);
        if (!status || !['admin','found','manager','mod'].includes(status)) {
            return reply.redirect('/home');
        }

        const staffFilter = req.query.staff || null;
        const verdictFilter = req.query.verdict || null;
        const page = parseInt(req.query.page) || 1;
        const pageSize = 50;
        const offset = (page - 1) * pageSize;

        let sql = `
            SELECT f.id, f.post, f.reason, f.reporter, f.date, f.moderator, f.checkdate, f.status,
                   u1.color AS reporter_color, u2.color AS moderator_color, u2.status AS moderator_status
            FROM flags f
            LEFT JOIN users u1 ON f.reporter = u1.username
            LEFT JOIN users u2 ON f.moderator = u2.username
            WHERE 1=1
        `;
        const params = [];

        if (staffFilter) {
            sql += ` AND f.reporter = ?`;
            params.push(staffFilter);
        }
        if (verdictFilter) {
            sql += ` AND f.status = ?`;
            params.push(verdictFilter);
        }

        sql += ` ORDER BY f.date DESC LIMIT ? OFFSET ?`;
        params.push(pageSize, offset);

        const [rows] = await fastify.db.query(sql, params);

        const flags = rows.map(r => {
            const now = DateTime.now().setZone("Europe/Moscow");
            const flaggedAt = DateTime.fromJSDate(new Date(r.date)).setZone("Europe/Moscow").setLocale("en-US").toFormat("LLL d, yyyy");
            const reviewedAt = r.checkdate ? DateTime.fromJSDate(new Date(r.checkdate)).setZone("Europe/Moscow").setLocale("en-US").toFormat("LLL d, yyyy"): null;
            
            return {
                id: r.id,
                post: r.post,
                reason: r.reason,
                reporter: r.reporter,
                reportercolor: r.reporter_color,
                moderator: r.moderator,
                moderatorcolor: r.moderator_color,
                moderatorstatus: r.moderator_status,
                date: flaggedAt.toLocaleString(DateTime.DATETIME_MED),
                checkdate: reviewedAt ? reviewedAt.toLocaleString(DateTime.DATETIME_MED) : null,
                status: r.status
            };
        });

        let countSql = `SELECT COUNT(*) AS total FROM flags WHERE 1=1`;
        const countParams = [];
        if (staffFilter) {
            countSql += ` AND reporter = ?`;
            countParams.push(staffFilter);
        }
        if (verdictFilter) {
            countSql += ` AND status = ?`;
            countParams.push(verdictFilter);
        }
        const [countRows] = await fastify.db.query(countSql, countParams);
        const totalCount = countRows[0].total;
        const totalPages = Math.ceil(totalCount / pageSize);

        return reply.view('admin/logs/flags.html', {
            flags,
            totalCount,
            page,
            totalPages,
            staffFilter,
            verdictFilter,
        });
    });
}