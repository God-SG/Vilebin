import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const MESSAGES_FILE = path.join(__dirname, 'messages.json')

export const messages = []

if (fs.existsSync(MESSAGES_FILE)) {
    const loaded = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf-8'))
    messages.push(...loaded)
} else {
    messages.push({
        messageID: 1,
        content: '<span style="color: #808080">Chat cleared!</span>',
        createdAt: new Date().toUTCString(),
        displayName: 'Vilebin',
        userID: null
    })
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2), 'utf-8')
}

const activeConnections = new Map()
let onlineUsers = 0
let fakeOnlineUsers = 150

export function broadcast(message) {
    const str = typeof message === 'string' ? message : JSON.stringify(message)
    for (const [, conn] of activeConnections) {
        try { conn.ws.send(str) } catch {}
    }
}

export async function updatePage(username) {
    broadcastToUsername(username, { event: 'refresh', data: null })
}

export function broadcastToClient(clientId, message) {
    const str = typeof message === 'string' ? message : JSON.stringify(message)
    for (const [, conn] of activeConnections) {
        if (conn.clientId === clientId) {
            try { conn.ws.send(str) } catch {}
        }
    }
}

export function broadcastToUsername(username, message) {
    const str = typeof message === 'string' ? message : JSON.stringify(message)
    for (const [, conn] of activeConnections) {
        if (conn.username === username) {
            try { conn.ws.send(str) } catch {}
        }
    }
}

export function updateOnline() {
    broadcast({ event: 'online', data: fakeOnlineUsers })
}

export function sendMessageToAll(message) {
    broadcast({ event: 'send_message', data: message })
}

export function sendMessage(clientId, message) {
    broadcastToClient(clientId, { event: 'send_message', data: message })
}

export function clearChat() {
    messages.length = 0
    broadcast({ event: 'clear_chat', data: null })
}

export function deleteMessage(messageId) {
    const idx = messages.findIndex(m => String(m.messageID) === String(messageId))
    if (idx !== -1) messages.splice(idx, 1)
    broadcast({ event: 'delete_message', data: { messageID: messageId } })
}

export function sendNotifyStaff(title, body, url) {
    broadcast({ event: 'notify', data: { title, body, url } })
}

export function sendNotify(username, title, body, url) {
    broadcastToUsername(username, { event: 'notify', data: { title, body, url } })
}

setInterval(() => {
    const hour = new Date().getHours()

    let min = 110
    let max = 210

    if (hour >= 0 && hour < 6) {
        min = 110
        max = 140
    } else if (hour >= 6 && hour < 12) {
        min = 130
        max = 170
    } else if (hour >= 12 && hour < 18) {
        min = 160
        max = 200
    } else if (hour >= 18 && hour < 23) {
        min = 180
        max = 210
    } else {
        min = 140
        max = 180
    }

    const target = Math.floor(Math.random() * (max - min + 1)) + min

    let diff = target - fakeOnlineUsers

    let step = Math.ceil(Math.abs(diff) / 10)

    step += Math.floor(Math.random() * 3)

    if (diff > 0) {
        fakeOnlineUsers += step
    } else if (diff < 0) {
        fakeOnlineUsers -= step
    }

    fakeOnlineUsers = Math.max(fakeOnlineUsers, Math.max(min, onlineUsers))
    fakeOnlineUsers = Math.min(fakeOnlineUsers, max)

    updateOnline()
}, 3000)

let lastMtime = 0
setInterval(() => {
    try {
        const mtime = fs.statSync(MESSAGES_FILE).mtimeMs
        if (mtime !== lastMtime) {
            lastMtime = mtime
            const loaded = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf-8'))
            messages.length = 0
            messages.push(...loaded)
        }
    } catch {}
}, 1000)

export default function(fastify) {
    fastify.get('/ws/:clientId', { websocket: true }, (socket, req) => {
        const clientId = req.params.clientId
        const username = req.query.username || null
        const connectionId = randomUUID()

        activeConnections.set(connectionId, { ws: socket, clientId, username })
        onlineUsers++
        fakeOnlineUsers = Math.max(fakeOnlineUsers, onlineUsers)
        updateOnline()

        socket.send(JSON.stringify({ event: 'init', data: messages }))

        socket.on('message', async (raw) => {
            const data = raw.toString().trim()
            if (data === 'clear_chat') {
                clearChat()
            } else if (data.startsWith('send_message:')) {
                const content = data.slice('send_message:'.length)
                const message = {
                    username,
                    message: content,
                    id: String(messages.length + 1)
                }
                messages.push(message)
                broadcast({ event: 'send_message', data: message })
            } else if (data.startsWith('delete_message:')) {
                deleteMessage(data.slice('delete_message:'.length))
            } else if (data === 'refresh') {
                broadcastToUsername(username, { event: 'refresh', data: null })
            }
        })

        socket.on('close', () => {
            activeConnections.delete(connectionId)
            onlineUsers--
            fakeOnlineUsers = Math.max(fakeOnlineUsers, onlineUsers, 110)
            updateOnline()
        })

        socket.on('error', (err) => fastify.log.error('WebSocket error:', err))
    })
}