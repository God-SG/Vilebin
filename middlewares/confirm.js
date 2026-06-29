export default function (fastify) {
    fastify.addHook('onRequest', async (request, reply) => {
        const confirm = request.cookies.confirm
        const url = request.raw.url
        const ua = request.headers['user-agent'] || ''

        const isBot = /googlebot|bingbot|yandex|duckduckbot|slurp|baiduspider|twitterbot|facebookexternalhit|crawl|spider|bot/i.test(ua)

        if (isBot) return
        if (url.startsWith('/confirm') || url.startsWith('/static')) return
        if (!confirm) {
            const next = encodeURIComponent(url)
            return reply.redirect(`/confirm?next=${next}`)
        }
    });
}