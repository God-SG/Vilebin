export default function (fastify) {
    fastify.get('/support', async (req, reply) => {
        return reply.view('support.html');
    });
}