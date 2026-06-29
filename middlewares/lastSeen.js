import { getSessionUsername } from './session.js'

export default function(fastify) {
    fastify.addHook('onRequest', async (req, reply) => {
        if (req.url.startsWith('/api')) return

        const session_username = await getSessionUsername(req)
        if (!session_username) return

        const now = new Date()
        const nowStr = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }))
            .toLocaleString('sv-SE', { timeZone: 'Europe/Moscow' })
            .replace('T', ' ')

        const [[user]] = await fastify.db.query('SELECT lastseen FROM users WHERE username = ?', [session_username])
        if (!user) return

        await fastify.db.query('UPDATE users SET lastseen = ? WHERE username = ?', [nowStr, session_username])
    })
}