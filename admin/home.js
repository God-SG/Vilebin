import { getSessionUsername } from '../middlewares/session.js'
import { getStatus } from '../utils.js'

function sanitizeHTML(html) {
    if (!html) return '';
    html = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
    html = html.replace(/\son\w+="[^"]*"/gi, '');
    html = html.replace(/\son\w+='[^']*'/gi, '');
    html = html.replace(/(href|src)=["']javascript:[^"']*["']/gi, '$1="#"');
    return html;
}

export default function (fastify) {
    fastify.get('/', async (req, reply) => {
        const username = await getSessionUsername(req);

        if (!username) return reply.redirect('/home');

        const status = await getStatus(req, username);
        if (!status || !['admin', 'founder','manager', 'mod'].includes(status)) return reply.redirect('/home');

        const [announcements_raw] = await fastify.db.query(`
            SELECT id, text, color, created_at
            FROM announcements
            ORDER BY created_at DESC
        `);

        const [hoas_raw] = await fastify.db.query(`
            SELECT id, title, description, image
            FROM hoa
            ORDER BY id DESC
        `);

        const currentEntries = hoas_raw.map(row => ({
            description: sanitizeHTML(row.description),
            hoaID: row.id,
            name: sanitizeHTML(row.title)
        }));

        const currentAnnouncements = announcements_raw.map(row => ({
            announcedAt: Math.floor(new Date(row.created_at).getTime() / 1000),
            announcedBy: 0,
            announcementID: row.id,
            color: row.color,
            message: sanitizeHTML(row.text)
        }));

        return reply.view('admin/home.html', {
            currentEntries: JSON.stringify(currentEntries),
            currentAnnouncements: JSON.stringify(currentAnnouncements)
        });
    });
}