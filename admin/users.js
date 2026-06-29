import { getSessionUsername } from '../middlewares/session.js'
import { getStatus } from '../utils.js'

export default function (fastify) {
    fastify.get('/users', async (req, reply) => {
        const session_username = await getSessionUsername(req);
        if (!session_username) return reply.redirect('/home');
        const status = await getStatus(req, session_username);
        if (!status || !['admin', 'manager', 'mod'].includes(status)) return reply.redirect('/home');
        
        return reply.view('admin/users.html');
    })

    fastify.post('/users', async (req, reply) => {
        const session_username = await getSessionUsername(req);
        if (!session_username) return reply.redirect('/home');
        const status = await getStatus(req, session_username);
        if (!status || !['admin', 'manager', 'mod'].includes(status)) return reply.redirect('/home');

        const { user_id, username, email, rank } = req.body
        const canSeeEmail = ['admin', 'manager'].includes(status)

        let query = 'SELECT id, username, email, status, ban FROM users WHERE 1=1'
        const params = []

        if (user_id) { query += ' AND id = ?'; params.push(user_id) }
        if (username) { query += ' AND username LIKE ?'; params.push(`%${username}%`) }
        if (email) { query += ' AND email LIKE ?'; params.push(`%${email}%`) }
        if (rank === 'default') {
            query += ' AND status = ?'
            params.push('user')
        } else if (rank) {
            query += ' AND status = ?'
            params.push(rank)
        }
        query += ' LIMIT 50'

        const [rows] = await fastify.db.query(query, params)

        const usersWithStatus = await Promise.all(rows.map(async (user) => {
            const keys = await fastify.redis.keys('session:*')
            let isActive = false
            for (const key of keys) {
                const data = await fastify.redis.get(key)
                if (data) {
                    const session = JSON.parse(data)
                    if (session.username === user.username && session.active) {
                        isActive = true
                        break
                    }
                }
            }
            return {
                ...user,
                active: isActive,
                email: canSeeEmail ? (user.email || null) : '[Hidden]'
            }
        }))

        return reply.view('admin/users.html', { users: usersWithStatus, canSeeEmail, search: req.body });
    })

    fastify.get('/users/:username', async (req, reply) => {
        const session_username = await getSessionUsername(req)
        if (!session_username) return reply.redirect('/home')
        const status = await getStatus(req, session_username)
        if (!status || !['admin', 'manager', 'mod'].includes(status)) return reply.redirect('/home')

        const { username } = req.params
        const canSeeEmail = ['admin', 'manager'].includes(status)

        const [[target]] = await fastify.db.query('SELECT * FROM users WHERE username = ?', [username])
        if (!target) return reply.redirect('/admin/users')

        const keys = await fastify.redis.keys('session:*')
        let userSessions = []
        for (const key of keys) {
            const data = await fastify.redis.get(key)
            if (data) {
                let session = JSON.parse(data)
                if (session.username === target.username) {
                    if (!session.first_seen) {
                        session.first_seen = session.login_at
                        await fastify.redis.set(key, JSON.stringify(session))
                    }
                    userSessions.push({ key, session })
                }
            }
        }

        userSessions.sort((a, b) => {
            const dateA = a?.session?.login_at ? new Date(a.session.login_at) : 0
            const dateB = b?.session?.login_at ? new Date(b.session.login_at) : 0
            return dateB - dateA
        })

        const sessions = userSessions.map(({ key, session }) => ({
            id: key.replace('session:', ''),
            first_seen: new Date(session.first_seen).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            last_seen: new Date(session.login_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            active: String(session.active)[0].toUpperCase() + String(session.active).slice(1)
        }))

        let [history] = await fastify.db.query(
            'SELECT username, note, date FROM username_history WHERE user_id = ? ORDER BY date DESC',
            [target.id]
        )
        if (!history.length) {
            history = [{ username: target.username, note: null, date: target.datejoin }]
        }

        const [audit] = await fastify.db.query(`
            SELECT a.type, a.data, a.date, u.username AS staff_username, u.status AS staff_status, u.color AS staff_color
            FROM audit_log a
            LEFT JOIN users u ON u.id = a.staff_id
            WHERE a.user_id = ?
            ORDER BY a.date DESC
        `, [target.id])

        return reply.view('admin/usermanage.html', {
            canSeeEmail,
            user: {
                id: target.id,
                username: target.username,
                email: canSeeEmail ? (target.email || null) : null,
                status: target.status,
                ban: target.ban,
                totp_enabled: target.totp_enabled,
                color: target.color,
                colorchanges: target.colorchanges,
                datejoin: (() => {
                    if (!target.datejoin) return 'IDK'
                    const d = target.datejoin.toString().trim()
                    const parts = d.split(' ')[0].split('-')
                    const date = parts[0].length === 4
                        ? new Date(target.datejoin)
                        : new Date(`${parts[2]}-${parts[1]}-${parts[0]}`)
                    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                })(),
                lastseen: (() => { if (!target.lastseen) return 'IDK'; const diff = Math.floor((Date.now() - new Date(target.lastseen)) / 1000); if (diff < 60) return `${diff} seconds ago`; if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`; if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`; return `${Math.floor(diff / 86400)} days ago` })(),
            },
            sessions,
            username_history: history.map(h => ({
                username: h.username,
                note: h.note,
                date: (() => {
                    if (!h.date) return 'IDK'

                    let date

                    if (h.date instanceof Date) {
                        date = h.date
                    } else {
                        const d = String(h.date).trim()
                        const [datePart] = d.split(' ')
                        const parts = datePart.split('-')

                        if (parts[0].length === 4) {
                            date = new Date(d.replace(' ', 'T'))
                        } else {
                            date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`)
                        }
                    }

                    return date.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                    })
                })()
            })),
            audit_log: audit.map(a => {
                let data;

                try {
                    data = a.data ? JSON.parse(a.data) : null;
                } catch {
                    data = a.data;
                }

                if (data === null) data = "None";

                return {
                    type: a.type,
                    data,
                    date: a.date ? new Date(a.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'IDK',
                    staff_username: a.staff_username,
                    staff_status: a.staff_status,
                    staff_color: a.staff_color
                };
            })
        })
    })
}