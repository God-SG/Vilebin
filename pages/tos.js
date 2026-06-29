export default function (fastify) {
    fastify.get('/tos', async (req, reply) => {
        return reply.view('tos.html');
    });
}