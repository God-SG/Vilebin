export default function (fastify) {
    fastify.get('/confirm', async (request, reply) => {
        const next = request.query.next || '/'

        if (request.cookies.confirm === 'yes') {
            return reply.redirect(next)
        }

        return reply.view('confirm.html', {
            next
        })
    })

    fastify.post('/confirm', async (request, reply) => {
        const next = request.query.next || '/'

        reply.setCookie('confirm', 'yes', {
            path: '/',
            httpOnly: true,
            maxAge: 60 * 60 * 24 * 365
        })

        return reply.redirect(next)
    })
}