const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'req',
    password: '2825012',
    port: 5432
});

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, uniqueName + ext);
    }
});
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'ticket-app-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
    if (req.session && req.session.userId) return next();
    res.status(401).json({ error: 'Не авторизован' });
}

const userSockets = {};

io.on('connection', (socket) => {
    socket.on('register', (userId) => {
        userSockets[userId] = socket.id;
    });

    socket.on('disconnect', () => {
        for (const [userId, socketId] of Object.entries(userSockets)) {
            if (socketId === socket.id) {
                delete userSockets[userId];
                break;
            }
        }
    });
});

app.get('/', (req, res) => {
    if (req.session && req.session.userId) {
        res.redirect('/dashboard.html');
    } else {
        res.redirect('/login.html');
    }
});

app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Заполните все поля' });
        }
        if (username.length > 14) {
            return res.status(400).json({ error: 'Имя пользователя — не более 14 символов' });
        }
        const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Пользователь уже существует' });
        }
        const result = await pool.query(
            'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id',
            [username, password]
        );
        req.session.userId = result.rows[0].id;
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Заполните все поля' });
        }
        const result = await pool.query('SELECT id, password FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Пользователь не найден' });
        }
        if (result.rows[0].password !== password) {
            return res.status(400).json({ error: 'Неверный пароль' });
        }
        req.session.userId = result.rows[0].id;
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, password, created_at FROM users WHERE id = $1',
            [req.session.userId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/change-password', requireAuth, async (req, res) => {
    try {
        const { old_password, new_password } = req.body;

        if (!old_password || !new_password) {
            return res.status(400).json({ error: 'Заполните все поля' });
        }

        const user = await pool.query(
            'SELECT password FROM users WHERE id = $1',
            [req.session.userId]
        );

        if (user.rows[0].password !== old_password) {
            return res.status(400).json({ error: 'Неверный старый пароль' });
        }

        await pool.query(
            'UPDATE users SET password = $1 WHERE id = $2',
            [new_password, req.session.userId]
        );

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/delete-account', requireAuth, async (req, res) => {
    try {
        const { password } = req.body;

        if (!password) {
            return res.status(400).json({ error: 'Введите пароль' });
        }

        const user = await pool.query(
            'SELECT password FROM users WHERE id = $1',
            [req.session.userId]
        );

        if (user.rows[0].password !== password) {
            return res.status(400).json({ error: 'Неверный пароль' });
        }

        /* удаляем файлы заявок пользователя с диска */
        const files = await pool.query(
            `SELECT a.file_path FROM attachments a
             JOIN requests r ON a.request_id = r.id
             WHERE r.creator_id = $1`,
            [req.session.userId]
        );

        for (const file of files.rows) {
            const filePath = path.join(uploadsDir, file.file_path);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        /* удаляем пользователя (каскадно удалятся все заявки, комментарии и тд) */
        await pool.query('DELETE FROM users WHERE id = $1', [req.session.userId]);

        req.session.destroy();
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/users', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username FROM users WHERE id != $1 ORDER BY username',
            [req.session.userId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/stats', requireAuth, async (req, res) => {
    try {
        const created = await pool.query(`
            SELECT 
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 1)::int AS closed,
                COUNT(*) FILTER (WHERE status = 0)::int AS open
            FROM requests WHERE creator_id = $1
        `, [req.session.userId]);

        const assigned = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE status = 1)::int AS closed,
                COUNT(*) FILTER (WHERE status = 0)::int AS open
            FROM requests WHERE assignee_id = $1
        `, [req.session.userId]);

        res.json({
            created_total: created.rows[0].total,
            created_closed: created.rows[0].closed,
            created_open: created.rows[0].open,
            assigned_closed: assigned.rows[0].closed,
            assigned_open: assigned.rows[0].open
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/requests', requireAuth, upload.array('files', 10), async (req, res) => {
    try {
        const { title, description, deadline_type, deadline_value, assignee_id } = req.body;
        if (!title || !deadline_type || !deadline_value || !assignee_id) {
            return res.status(400).json({ error: 'Заполните все обязательные поля' });
        }
        if (parseInt(assignee_id) === req.session.userId) {
            return res.status(400).json({ error: 'Нельзя создать заявку для себя' });
        }

        const result = await pool.query(
            `INSERT INTO requests (title, description, deadline_type, deadline_value, creator_id, assignee_id)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [title, description || '', deadline_type, deadline_value, req.session.userId, assignee_id]
        );

        const requestId = result.rows[0].id;

        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                await pool.query(
                    `INSERT INTO attachments (request_id, original_name, file_path, file_size)
                     VALUES ($1, $2, $3, $4)`,
                    [requestId, file.originalname, file.filename, file.size]
                );
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/requests/created', requireAuth, async (req, res) => {
    try {
        const { filter, search } = req.query;
        let query = `
            SELECT r.*, u.username AS assignee_name
            FROM requests r
            JOIN users u ON r.assignee_id = u.id
            WHERE r.creator_id = $1`;
        const params = [req.session.userId];
        let paramIndex = 2;

        if (filter === '0' || filter === '1') {
            query += ` AND r.status = $${paramIndex}`;
            params.push(parseInt(filter));
            paramIndex++;
        }

        if (search && search.trim()) {
            query += ` AND (r.title ILIKE $${paramIndex} OR r.description ILIKE $${paramIndex})`;
            params.push(`%${search.trim()}%`);
            paramIndex++;
        }

        query += ` ORDER BY r.created_at DESC`;
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/requests/assigned', requireAuth, async (req, res) => {
    try {
        const { filter, search } = req.query;
        let query = `
            SELECT r.*, u.username AS creator_name
            FROM requests r
            JOIN users u ON r.creator_id = u.id
            WHERE r.assignee_id = $1`;
        const params = [req.session.userId];
        let paramIndex = 2;

        if (filter === '0' || filter === '1') {
            query += ` AND r.status = $${paramIndex}`;
            params.push(parseInt(filter));
            paramIndex++;
        }

        if (search && search.trim()) {
            query += ` AND (r.title ILIKE $${paramIndex} OR r.description ILIKE $${paramIndex})`;
            params.push(`%${search.trim()}%`);
            paramIndex++;
        }

        query += ` ORDER BY r.created_at DESC`;
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.delete('/api/requests/:id', requireAuth, async (req, res) => {
    try {
        const files = await pool.query(
            'SELECT file_path FROM attachments WHERE request_id = $1',
            [req.params.id]
        );

        const result = await pool.query(
            'DELETE FROM requests WHERE id = $1 AND creator_id = $2 RETURNING id',
            [req.params.id, req.session.userId]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Заявка не найдена' });

        for (const file of files.rows) {
            const filePath = path.join(uploadsDir, file.file_path);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.patch('/api/requests/:id/close', requireAuth, async (req, res) => {
    try {
        const check = await pool.query(
            'SELECT status FROM requests WHERE id = $1 AND assignee_id = $2',
            [req.params.id, req.session.userId]
        );
        if (check.rows.length === 0) return res.status(404).json({ error: 'Заявка не найдена' });
        if (check.rows[0].status === 1) return res.status(400).json({ error: 'Заявка уже закрыта' });
        await pool.query(
            'UPDATE requests SET status = 1 WHERE id = $1 AND assignee_id = $2',
            [req.params.id, req.session.userId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/attachments/:requestId', requireAuth, async (req, res) => {
    try {
        const access = await pool.query(
            'SELECT id FROM requests WHERE id = $1 AND (creator_id = $2 OR assignee_id = $2)',
            [req.params.requestId, req.session.userId]
        );
        if (access.rows.length === 0) {
            return res.status(403).json({ error: 'Нет доступа' });
        }

        const result = await pool.query(
            'SELECT id, original_name, file_size FROM attachments WHERE request_id = $1 ORDER BY created_at',
            [req.params.requestId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/download/:id', requireAuth, async (req, res) => {
    try {
        const file = await pool.query(
            `SELECT a.*, r.creator_id, r.assignee_id 
             FROM attachments a 
             JOIN requests r ON a.request_id = r.id 
             WHERE a.id = $1`,
            [req.params.id]
        );

        if (file.rows.length === 0) {
            return res.status(404).json({ error: 'Файл не найден' });
        }

        const f = file.rows[0];

        if (f.creator_id !== req.session.userId && f.assignee_id !== req.session.userId) {
            return res.status(403).json({ error: 'Нет доступа' });
        }

        const filePath = path.join(uploadsDir, f.file_path);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Файл не найден на диске' });
        }

        res.download(filePath, f.original_name);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/comments/:requestId', requireAuth, async (req, res) => {
    try {
        const access = await pool.query(
            'SELECT id FROM requests WHERE id = $1 AND (creator_id = $2 OR assignee_id = $2)',
            [req.params.requestId, req.session.userId]
        );
        if (access.rows.length === 0) {
            return res.status(403).json({ error: 'Нет доступа' });
        }

        const result = await pool.query(
            `SELECT c.*, u.username 
             FROM comments c 
             JOIN users u ON c.user_id = u.id 
             WHERE c.request_id = $1 
             ORDER BY c.created_at ASC`,
            [req.params.requestId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/comments', requireAuth, async (req, res) => {
    try {
        const { request_id, text } = req.body;

        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Введите текст сообщения' });
        }

        const access = await pool.query(
            'SELECT creator_id, assignee_id FROM requests WHERE id = $1 AND (creator_id = $2 OR assignee_id = $2)',
            [request_id, req.session.userId]
        );
        if (access.rows.length === 0) {
            return res.status(403).json({ error: 'Нет доступа' });
        }

        await pool.query(
            'INSERT INTO comments (request_id, user_id, text) VALUES ($1, $2, $3)',
            [request_id, req.session.userId, text.trim()]
        );

        const r = access.rows[0];
        const recipientId = r.creator_id === req.session.userId ? r.assignee_id : r.creator_id;

        if (userSockets[recipientId]) {
            io.to(userSockets[recipientId]).emit('new-message', {
                request_id: request_id
            });
        }

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/comments/read', requireAuth, async (req, res) => {
    try {
        const { request_id } = req.body;
        await pool.query(
            `INSERT INTO comment_reads (user_id, request_id, last_read_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (user_id, request_id)
             DO UPDATE SET last_read_at = NOW()`,
            [req.session.userId, request_id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/unread-counts', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.request_id, COUNT(*)::int AS unread_count
            FROM comments c
            JOIN requests r ON c.request_id = r.id
            LEFT JOIN comment_reads cr ON cr.request_id = c.request_id AND cr.user_id = $1
            WHERE (r.creator_id = $1 OR r.assignee_id = $1)
              AND c.user_id != $1
              AND (cr.last_read_at IS NULL OR c.created_at > cr.last_read_at)
            GROUP BY c.request_id
        `, [req.session.userId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

/* запуск сервера */
server.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
});