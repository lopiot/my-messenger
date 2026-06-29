const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const JWT_SECRET = 'my_super_secret_key_123';
const USERS_FILE = path.join(__dirname, 'users.json');
const MESSAGES_FILE = path.join(__dirname, 'messages.json');

function readUsers() {
    if (!fs.existsSync(USERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8') || '[]');
}
function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function readMessages() {
    if (!fs.existsSync(MESSAGES_FILE)) return [];
    return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8') || '[]');
}
function saveMessage(msg) {
    const messages = readMessages();
    messages.push(msg);
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2), 'utf8');
}

app.use(express.json());
app.use(express.static('public'));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});


// Регистрация
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Заполните все поля' });

        const users = readUsers();
        if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
            return res.status(400).json({ error: 'Такой login уже занят' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ username, password: hashedPassword });
        saveUsers(users);

        res.status(201).json({ message: 'Готово!' });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Вход
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const users = readUsers();
        const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
        
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ error: 'Неверный логин или пароль' });
        }

        const token = jwt.sign({ username: user.username }, JWT_SECRET);
        res.json({ token, username: user.username });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Роут для поиска пользователей
app.get('/api/users', (req, res) => {
    const users = readUsers().map(u => u.username);
    res.json(users);
});

let onlineUsers = {};

io.on('connection', (socket) => {
    socket.on('user join', (username) => {
        socket.username = username;
        onlineUsers[username] = socket.id;
        
        // Отправляем список пользователей, с которыми у юзера уже есть диалоги
        const allMessages = readMessages();
        const chatPartners = new Set();
        allMessages.forEach(m => {
            if (m.from === username) chatPartners.add(m.to);
            if (m.to === username) chatPartners.add(m.from);
        });

        socket.emit('my chats', Array.from(chatPartners));
        io.emit('online update', Object.keys(onlineUsers));
    });

    // Запрос истории конкретного ЛС
    socket.on('get private history', (data) => {
        const allMessages = readMessages();
        // Фильтруем сообщения только между этими двумя пользователями
        const history = allMessages.filter(m => 
            (m.from === data.me && m.to === data.with) || 
            (m.from === data.with && m.to === data.me)
        );
        socket.emit('chat history', history);
    });

    // Личные сообщения
    socket.on('private message', (data) => {
        const msgObject = {
            from: data.from,
            to: data.to,
            username: data.from, // Для совместимости с фронтендом
            text: data.text,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        
        saveMessage(msgObject);
        
        // Отправляем отправителю
        socket.emit('chat message', msgObject);
        
        // Отправляем получателю
        const targetSocketId = onlineUsers[data.to];
        if (targetSocketId) {
            io.to(targetSocketId).emit('chat message', msgObject);
            // Обновляем список чатов у получателя, если диалог новый
            io.to(targetSocketId).emit('new chat alert', data.from);
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            delete onlineUsers[socket.username];
            io.emit('online update', Object.keys(onlineUsers));
        }
    });
});

const PORT = 3000;
http.listen(PORT, () => {
    console.log(`Сервер ЛС запущен на http://localhost:${PORT}`);
});