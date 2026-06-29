import { getSessionUsername } from '../middlewares/session.js';
import { getStatus } from '../utils.js';

export default function(fastify) {
    fastify.get('/users', async (req, reply) => {
        const username = await getSessionUsername(req);
        const status = await getStatus(req, username);

        const isAdmin = status === 'admin' && username === 'Admin';
        const isStaff = ['admin', 'manager', 'mod'].includes(status);

        const deletedFilter = isStaff ? '1=1' : 'p.deleted = 0';

        const specialStatuses = [
            'admin','manager','mod','rich','council','clique','criminal','vip'
        ];
        const placeholders = specialStatuses.map(() => '?').join(',');

        const [
            [totalRow],
            [specialUsers],
            [regularUsers],
            [pastesCount],
            [commentsCount]
        ] = await Promise.all([
            fastify.db.query(
                `SELECT COUNT(*) as count FROM users u WHERE 1=1`
            ),
            fastify.db.query(
                `SELECT u.id, u.username, u.status, u.datejoin, u.avatar, u.badges, u.color
                FROM users u
                WHERE u.status IN (${placeholders})`,
                specialStatuses
            ),
            fastify.db.query(
                `SELECT u.id, u.username, u.status, u.datejoin, u.avatar, u.badges, u.color
                FROM users u
                WHERE u.status = 'user'
                ORDER BY u.id DESC LIMIT 100`
            ),
            fastify.db.query(
                `SELECT p.owner, COUNT(*) as count
                FROM pastes p
                WHERE ${deletedFilter}
                GROUP BY p.owner`
            ),
            fastify.db.query(
                `SELECT p.owner, COUNT(*) as total
                FROM pastes_comments pc
                INNER JOIN pastes p ON pc.paste_id = p.id
                WHERE pc.deleted = 0 AND ${deletedFilter}
                GROUP BY p.owner`
            )
        ]);

        const totalUsers = (totalRow[0]?.count ?? 0) + 500;
        const pastesDict = Object.fromEntries(pastesCount.map(r => [r.owner, r.count]));
        const commentsDict = Object.fromEntries(commentsCount.map(r => [r.owner, r.total ?? 0]));

        const formatDate = (users) => users.map(user => {
            const raw = user.datejoin;
            let formatted = raw;

            if (raw) {
                let dt;
                const matchDMY = String(raw).match(/^(\d{2})-(\d{2})-(\d{4})/);
                if (matchDMY) {
                    const [_, day, month, year] = matchDMY;
                    dt = new Date(`${year}-${month}-${day}`);
                } else {
                    const matchYMD = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
                    if (matchYMD) {
                        const [_, year, month, day] = matchYMD;
                        dt = new Date(`${year}-${month}-${day}`);
                    }
                }
                if (dt && !isNaN(dt)) {
                    const monthName = dt.toLocaleString('en-US', { month: 'short' });
                    formatted = `${monthName} ${parseInt(dt.getDate())}, ${dt.getFullYear()}`;
                }
            }

            return { ...user, formatted_date: formatted };
        });

        const usersByStatus = Object.fromEntries(specialStatuses.map(s => [s, []]));
        for (const user of specialUsers) {
            usersByStatus[user.status]?.push(user);
        }

        return reply.view('users/index.html', {
            all_users: totalUsers,
            admin_users:     formatDate(usersByStatus['admin']),
            manager_users:   formatDate(usersByStatus['manager']),
            mod_users:       formatDate(usersByStatus['mod']),
            rich_users:      formatDate(usersByStatus['rich']),
            council_users:   formatDate(usersByStatus['council']),
            clique_users:    formatDate(usersByStatus['clique']),
            criminal_users:  formatDate(usersByStatus['criminal']),
            vip_users:       formatDate(usersByStatus['vip']),
            regular_users:   formatDate(regularUsers),
            username,
            status,
            pastes_dict:     pastesDict,
            comments_dict:   commentsDict,
        });
    });

    fastify.post('/users', async (req, reply) => {
        const username = await getSessionUsername(req);
        const { search_query } = req.body;

        if (!search_query || search_query.length < 2) {
            return reply.redirect('/users');
        }

        const status = await getStatus(req, username);
        const isStaff = ['admin', 'manager', 'mod'].includes(status);
        const deletedFilter = isStaff ? '1=1' : 'p.deleted = 0';
        const commentDeletedFilter = isStaff ? '1=1' : 'pc.deleted = 0';

        const [[usersRows], [totalRow]] = await Promise.all([
            fastify.db.query(
                `SELECT id, username, status, datejoin, color
                 FROM users WHERE username LIKE ? LIMIT 100`,
                [`%${search_query}%`]
            ),
            fastify.db.query('SELECT COUNT(*) AS total FROM users')
        ]);

        const allUsers = (totalRow[0]?.total ?? 0) + 500;

        if (!usersRows.length) {
            return reply.view('users/search.html', {
                all_users: allUsers,
                found_users: [],
                username,
                status,
                pastes_dict: {},
                comments_dict: {},
                search_query,
            });
        }

        const foundUsernames = usersRows.map(r => r.username);
        const ph = foundUsernames.map(() => '?').join(',');

        const [[pastesRows], [commentsRows]] = await Promise.all([
            fastify.db.query(
                `SELECT p.owner, COUNT(*) as count
                 FROM pastes p
                 WHERE p.owner IN (${ph}) AND ${deletedFilter}
                 GROUP BY p.owner`,
                foundUsernames
            ),
            fastify.db.query(
                `SELECT p.owner, COUNT(*) as total
                FROM pastes_comments pc
                INNER JOIN pastes p ON pc.paste_id = p.id
                WHERE ${commentDeletedFilter} AND ${deletedFilter}
                GROUP BY p.owner`
            )
        ]);

        return reply.view('users/search.html', {
            all_users: allUsers,
            found_users: usersRows.map(r => [r.id, r.username, r.status, r.datejoin, r.color]),
            username,
            status,
            pastes_dict: Object.fromEntries(pastesRows.map(r => [r.owner, r.count])),
            comments_dict: Object.fromEntries(commentsRows.map(r => [r.owner, r.total ?? 0])),
            search_query,
        });
    });
}