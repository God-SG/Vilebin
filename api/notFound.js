export default function (fastify) {
    fastify.all('/*', async (req, reply) => {
        return reply.status(404).send({ success: false, message: 'API method not found' });
    })
}