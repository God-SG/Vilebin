# ShadowGarden on Top!

### Want an actual bin site? [Diddybin](https://diddybin.net)

---

## Vilebin Source

This is the source code for Vilebin -- a doxbin-style paste site built on Node.js, Fastify, MySQL, and Redis. Every "stat" you see on the live site is artificially inflated. The view counts are fake. The online users are fake. The follower counts are fake. Here's the proof, straight from the code.

---

## Fake Paste Views

Every time a public or unlisted paste is created, a view bot kicks in and adds **80 to 220 fake views** to it automatically.

**The bot trigger** -- [`api/upload/uploadPaste.js`](api/upload/uploadPaste.js) lines 144-146:
```js
if (finalType === 'public' || finalType === 'unlisted') {
    incrementViews(fastify, title);
}
```

**The bot itself** -- [`utils.js`](utils.js) lines 62-121:
```js
export function incrementViews(fastify, pasteTitle) {
    if (activeViewBots.has(pasteTitle)) return;

    activeViewBots.add(pasteTitle);

    const maxViews = Math.floor(Math.random() * (220 - 80 + 1)) + 80; // 80-220 fake views
    let current = 0;

    async function tick() {
        // ... increments view by 1 in the DB each tick ...
        const delay = Math.floor(Math.random() * 15000) + 5000; // waits 5-20 seconds between each fake view
        setTimeout(tick, delay);
    }

    tick();
}
```

It runs `UPDATE pastes SET view = view + 1` in a loop with random delays so it looks organic. It isn't.

---

## Fake Online Users

The "online users" count in the navbar is completely fabricated. The real WebSocket connection count is never shown to anyone.

**Hardcoded starting value** -- [`websocket.js`](websocket.js) line 29:
```js
let fakeOnlineUsers = 150
```

**What gets broadcasted** -- [`websocket.js`](websocket.js) lines 60-62:
```js
export function updateOnline() {
    broadcast({ event: 'online', data: fakeOnlineUsers }) // sends fake count, not real
}
```

**The drift loop** -- [`websocket.js`](websocket.js) lines 91-132:

Every 3 seconds, the fake count drifts toward a random target within time-of-day ranges:

| Time of Day | Fake Range |
|---|---|
| 12am - 6am | 110 - 140 |
| 6am - 12pm | 130 - 170 |
| 12pm - 6pm | 160 - 200 |
| 6pm - 11pm | 180 - 210 |
| 11pm - 12am | 140 - 180 |

None of these numbers reflect real users. It's a `setInterval` generating random numbers.

---

## Inflated User Count (+500)

The total user count shown on the users page has 500 ghost users added to it.

[`pages/users.js`](pages/users.js) line 56:
```js
const totalUsers = (totalRow[0]?.count ?? 0) + 500;
```

[`pages/users.js`](pages/users.js) line 131 (search page):
```js
const allUsers = (totalRow[0]?.total ?? 0) + 500;
```

---

## Inflated Follower Count (+958,473)

The profiles "Admin" and "shy" have **958,473 fake followers** added to their real count.

[`templates/profile/index.html`](templates/profile/index.html) line 957:
```html
<span class="follow-count">{% if login in ['Admin', 'shy'] %}{{ followers_count + 958473 }}{% else %}{{ followers_count }}{% endif %}</span>
```

Nearly a million fake followers hardcoded in a Nunjucks template.

---

## Summary

| Metric | Fake? | Where | Lines |
|---|---|---|---|
| Paste views | Yes -- adds 80-220 per upload | `utils.js` | 62-121 |
| Paste view trigger | Yes | `api/upload/uploadPaste.js` | 144-146 |
| Online users | Yes -- shows 110-210 fake range | `websocket.js` | 29, 60-62, 91-132 |
| Total user count | Yes -- +500 | `pages/users.js` | 56, 131 |
| Follower count (Admin/shy) | Yes -- +958,473 | `templates/profile/index.html` | 957 |

Every number on this site is a lie. Use [Diddybin](https://diddybin.net) instead.
