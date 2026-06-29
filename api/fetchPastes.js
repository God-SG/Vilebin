import { getSessionUsername } from '../middlewares/session.js'
import { getIP, getStatus } from '../utils.js'

const searchRateLimit = new Map()

function checkSearchRateLimit(ip) {
    const now = Date.now()
    const windowMs = 60 * 1000
    const maxRequests = 25

    const entry = searchRateLimit.get(ip)

    if (!entry || now - entry.timestamp > windowMs) {
        searchRateLimit.set(ip, { count: 1, timestamp: now })
        return true
    }

    if (entry.count >= maxRequests) {
        return false
    }

    entry.count++
    return true
}

setInterval(() => {
    const now = Date.now()
    for (const [ip, entry] of searchRateLimit.entries()) {
        if (now - entry.timestamp > 60 * 1000) {
            searchRateLimit.delete(ip)
        }
    }
}, 5 * 60 * 1000)

export default function (fastify) {
    fastify.get('/fetchPastes', async (req, reply) => {
        const page = parseInt(req.query.page) || 1
        const search = req.query.search?.trim() || ''
        const searchType = req.query.searchType || 'title'
        const targetLimit = 100 
        const username = await getSessionUsername(req)
        const status = await getStatus(req, username)
        const isStaff = ['admin','founder', 'manager', 'mod'].includes(status)

        if (search) {
            const ip = await getIP(req);
            if (!checkSearchRateLimit(ip)) {
                return reply.code(429).send({ success: false, error: 'Rate limit exceeded' })
            }
        }

        if (search && (search.length < 2 || !/^[\p{L}0-9\s]+$/u.test(search))) {
            return reply.code(400).send({ success: false, error: 'Invalid search query' })
        }

        const baseWhere = isStaff ? `1=1` : `p.deleted = 0`

        let searchCondition = ''
        let searchParams = []
        if (search) {
            const searchPattern = `*${search}*`
            if (searchType === 'title') {
                searchCondition = `AND MATCH(p.pastname) AGAINST (? IN BOOLEAN MODE)`
            } else {
                searchCondition = `AND MATCH(p.pastname, p.past) AGAINST (? IN BOOLEAN MODE)`
            }
            searchParams = [searchPattern]
        }

        const [styles] = await fastify.db.query(`SELECT * FROM styles`)


        const [[{ total }]] = await fastify.db.query(
            `SELECT COUNT(*) AS total 
             FROM pastes p 
             WHERE ${baseWhere} AND p.pin = 0 ${searchCondition}`,
            searchParams
        )


        const formatRow = (row) => {
            if (
                (username || '').toLowerCase() !== (row.owner || '').toLowerCase() &&
                ['private', 'unlisted'].includes(row.type) &&
                !isStaff
            ) {
                return null
            }

            const style = styles.find(s => s.role === row.status)
            const formattedDate = new Date(row.created_at)
                .toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                })
            const commentsCount = row.commentsstatus
                ? parseInt(row.comments_count) || 0
                : '—'

            const base = {
                id: row.id,
                author: row.owner && row.owner !== 'Anonymous' ? row.owner : null,
                comments: commentsCount,
                created_at: formattedDate,
                link: row.pastname_c,
                title: row.pastname,
                type: row.deleted === 1 ? 'sealed' : row.type,
                usernameColor: row.color || null,
                views: parseInt(row.view) || 0,
                password: !!row.password
            }

            if (!style) return base
            return {
                ...base,
                rank: style.role,
                rankColor: style.rankColor,
                rankHighlightColor: style.rankHighlightColor,
                rankStyle: style.rankStyle,
                rankSuffix: style.suffix
            }
        }

   
        let pastes = []
        let currentOffset = (page - 1) * targetLimit
        let maxIterations = 20
        
        while (pastes.length < targetLimit && maxIterations > 0) {
  
            const fetchLimit = 200
            
            const [rows] = await fastify.db.query(`
                SELECT 
                    p.id,
                    p.owner,
                    p.created_at,
                    p.pastname,
                    p.pastname_c,
                    p.type,
                    p.view,
                    p.deleted,
                    p.commentsstatus,
                    p.password,
                    u.status,
                    u.color,
                    (
                        SELECT COUNT(*) 
                        FROM pastes_comments pc
                        WHERE pc.paste_id = p.id
                        ${!isStaff ? 'AND pc.deleted = 0' : ''}
                    ) AS comments_count
                FROM pastes p
                LEFT JOIN users u ON u.username = p.owner
                WHERE ${baseWhere} AND p.pin = 0 ${searchCondition}
                ORDER BY p.created_at DESC
                LIMIT ? OFFSET ?
            `, [...searchParams, fetchLimit, currentOffset])
            
            if (rows.length === 0) break
            
            const formattedRows = rows.map(formatRow).filter(Boolean)
            pastes.push(...formattedRows)
            
            currentOffset += rows.length
            maxIterations--
        }
        
       
        pastes = pastes.slice(0, targetLimit)

        return {
            page,
            pastes,
            total: total,
            totalPages: Math.ceil(total / targetLimit)
        }
    })
}