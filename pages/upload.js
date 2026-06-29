export default function (fastify) {
    fastify.get('/upload', async (req, reply) => {
        return reply.view('upload/new.html');
    });
}