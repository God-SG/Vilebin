import sanitizeHtml from 'sanitize-html';

import { getStatus, getColor } from '../utils.js';
import { getSessionUsername } from '../middlewares/session.js';

export default function (fastify) {
    fastify.get('/', async (req, reply) => {
        return reply.redirect('/home');
    });

    fastify.get('/home', async (req, reply) => {
        const username = await getSessionUsername(req);
        const status = await getStatus(req, username);
        const is_staff = ['admin', 'manager', 'mod'].includes(status);

        const [pinned_posts] = await fastify.db.query(`
            SELECT 
                p.id,
                p.pastname,
                p.owner,
                p.created_at,
                p.view,
                p.pin,
                p.commentsstatus,
                p.deleted,
                p.type,
                u.status as owner_status,

                (
                    SELECT COUNT(*)
                    FROM pastes_comments pc
                    WHERE pc.paste_id = p.id
                    ${!is_staff ? 'AND pc.deleted = 0' : ''}
                ) AS comments_count

            FROM pastes p
            LEFT JOIN users u ON u.username = p.owner
            WHERE p.pin = TRUE
            ORDER BY p.id DESC
        `);

        const [announcements] = await fastify.db.query(`
            SELECT id, text, color
            FROM announcements
            ORDER BY created_at DESC
        `);

        const owners = new Set([...pinned_posts].map(p => p.owner));
        const colors = {};

        for (const owner of owners) {
            colors[owner] = await getColor(req, owner);
        }

        const formatPosts = (posts, pin = false) => {
            const list = [];

            for (const p of posts) {
                if (p.deleted && !is_staff) continue;
                if (p.type !== 'public' && p.owner !== username && !is_staff) continue;

                const date_obj = p.created_at instanceof Date
                    ? p.created_at
                    : new Date(p.created_at);

                const formatted_date = date_obj.toLocaleDateString('en-US', {
                    month: 'short',
                    day: '2-digit',
                    year: 'numeric'
                });

                let comments;

                if (!p.commentsstatus) {
                    comments = '—';
                } else {
                    comments = parseInt(p.comments_count) || 0;
                }

                list.push({
                    id: p.id,
                    name: p.pastname,
                    pastowner: p.owner,
                    pastownerstatus: p.owner_status || 'anonymous',
                    pastownercolor: colors[p.owner],
                    view: p.view,
                    formatted_date,
                    pin,
                    comments,
                    commentsstatus: p.commentsstatus,
                    delete: !!p.deleted,
                    type: p.type
                });
            }

            return list;
        };

        const pinned_posts_list = formatPosts(pinned_posts, true);

        // CLEAN
        const cleanAnnouncements = announcements.map(a => ({
            ...a,
            text: sanitizeHtml(a.text, {
                allowedTags: [
                    'a', 'b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li'
                ],
                allowedAttributes: {
                    a: ['href', 'target', 'rel', 'style']
                },
                allowedSchemes: ['http', 'https', 'mailto'],
                transformTags: {
                    'a': sanitizeHtml.simpleTransform('a', {
                        target: '_blank',
                        rel: 'noopener noreferrer'
                    })
                }
            })
        }));

        return reply.view('home.html', {
            pinned_posts_list,
            status,
            announcements: cleanAnnouncements
        });
    });
}