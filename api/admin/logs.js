import * as config from '../../config.js';

import { getSessionUsername } from "../../middlewares/session.js";
import { getStatus, getColor } from "../../utils.js";

const PER_PAGE = 10;

async function enrichEntries(req, rows) {
    const entries = [];
    for (const row of rows) {
        const login_status = await getStatus(req, row.login);
        const s = config.styles?.[login_status] ?? config.styles?.['user'] ?? {};
        entries.push({
            id: row.id,
            type: row.type,
            deys: row.deys,
            login: row.login,
            date: row.date,
            login_status,
            login_color: await getColor(req, row.login),
            rank_style: s.rankStyle ?? '',
            suffix: s.suffix ?? '',
        });
    }
    return entries;
}

export default async function (fastify) {
    fastify.get('/logs', async (req, reply) => {
        const username = await getSessionUsername(req);
        if (!username) return reply.code(401).send({ error: 'Unauthorized' });

        const status = await getStatus(req, username);
        if (!status || !['admin','founder', 'manager'].includes(status)) return reply.code(401).send({ error: 'Unauthorized' });

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const q = (req.query.q || '').trim();
        const offset = (page - 1) * PER_PAGE;

        if (q) {
            const like = '%' + q + '%';
            const base = [like, like, like, like];
            const [[{ cnt }]] = await fastify.db.query(
                `SELECT COUNT(*) AS cnt FROM logs WHERE deys LIKE ? OR login LIKE ? OR ipadr LIKE ? OR date LIKE ?`,
                base
            );
            const total = cnt;
            const total_pages = Math.max(1, Math.ceil(total / PER_PAGE));
            const [rows] = await fastify.db.query(
                `SELECT id, type, deys, login, date, ipadr FROM logs WHERE deys LIKE ? OR login LIKE ? OR ipadr LIKE ? OR date LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?`,
                [...base, PER_PAGE, offset]
            );
            const entries = await enrichEntries(req, rows);
            return reply.send({ entries, page, total_pages, total });
        } else {
            const [[{ cnt }]] = await fastify.db.query(`SELECT COUNT(*) AS cnt FROM logs`);
            const total = cnt;
            const total_pages = Math.max(1, Math.ceil(total / PER_PAGE));
            const [rows] = await fastify.db.query(
                `SELECT id, type, deys, login, date, ipadr FROM logs ORDER BY id DESC LIMIT ? OFFSET ?`,
                [PER_PAGE, offset]
            );
            const entries = await enrichEntries(req, rows);
            return reply.send({ entries, page, total_pages, total });
        }
    });
}