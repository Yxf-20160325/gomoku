const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

// 初始化 Express 和 HTTP 服务器
const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-Content-Type-Options'],
    credentials: true,
    exposedHeaders: ['Content-Type', 'X-Content-Type-Options']
}));

// 添加x-content-type-options头部
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// 提供前端文件
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 获取房间列表
app.get('/api/rooms', (req, res) => {
    const roomList = [];
    rooms.forEach(room => {
        if (!room.started) { // 只返回未开始的房间
            roomList.push({
                id: room.id,
                players: room.players,
                playerCount: room.players.length
            });
        }
    });
    res.json({ rooms: roomList });
});

// 处理favicon.ico请求
app.get('/favicon.ico', (req, res) => {
    res.status(204).end(); // 204 No Content
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    maxHttpBufferSize: 1e8,
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

// 游戏房间管理
const rooms = new Map();
const users = new Map();

io.on('connection', (socket) => {
    console.log(`用户连接: ${socket.id}`);
    
    // 创建游戏房间
    socket.on('createGame', (data) => {
        const { username } = data;
        const roomId = 'game-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        
        // 创建房间
        rooms.set(roomId, {
            id: roomId,
            players: [{
                socketId: socket.id,
                username: username,
                color: 1 // 黑棋
            }],
            started: false,
            turn: 1 // 1=黑 2=白
        });
        
        // 保存用户信息
        users.set(socket.id, {
            socketId: socket.id,
            username: username,
            roomId: roomId,
            color: 1
        });
        
        // 加入房间
        socket.join(roomId);
        
        // 发送房间信息给创建者
        socket.emit('gameCreated', {
            roomId: roomId,
            color: 1
        });
        
        console.log(`${username} 创建了游戏房间 ${roomId}`);
    });
    
    // 加入游戏房间
    socket.on('joinGame', (data) => {
        const { username, roomId } = data;
        const room = rooms.get(roomId);
        
        if (!room) {
            socket.emit('joinError', { message: '房间不存在' });
            return;
        }
        
        if (room.players.length >= 2) {
            socket.emit('joinError', { message: '房间已满' });
            return;
        }
        
        // 添加玩家
        room.players.push({
            socketId: socket.id,
            username: username,
            color: 2 // 白棋
        });
        room.started = true;
        rooms.set(roomId, room);
        
        // 保存用户信息
        users.set(socket.id, {
            socketId: socket.id,
            username: username,
            roomId: roomId,
            color: 2
        });
        
        // 加入房间
        socket.join(roomId);
        
        // 发送房间信息给加入者
        socket.emit('gameJoined', {
            roomId: roomId,
            color: 2
        });
        
        // 通知房间内所有玩家游戏开始
        io.to(roomId).emit('gameStarted', {
            players: room.players,
            turn: room.turn
        });
        
        console.log(`${username} 加入了游戏房间 ${roomId}`);
    });
    
    // 转发游戏数据
    socket.on('gameData', (data) => {
        const user = users.get(socket.id);
        if (user && user.roomId) {
            // 转发数据给房间内其他玩家
            socket.to(user.roomId).emit('gameData', data);
        }
    });
    
    // 离开游戏
    socket.on('leaveGame', () => {
        const user = users.get(socket.id);
        if (user && user.roomId) {
            const room = rooms.get(user.roomId);
            if (room) {
                // 从房间中移除玩家
                room.players = room.players.filter(p => p.socketId !== socket.id);
                
                if (room.players.length === 0) {
                    // 房间为空，删除房间
                    rooms.delete(user.roomId);
                } else {
                    // 通知房间内其他玩家
                    io.to(user.roomId).emit('playerLeft', {
                        socketId: socket.id,
                        username: user.username
                    });
                }
            }
            
            // 清除用户信息
            users.delete(socket.id);
            socket.leave(user.roomId);
            
            console.log(`${user.username} 离开了游戏房间 ${user.roomId}`);
        }
    });
    
    // 断开连接处理
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user && user.roomId) {
            const room = rooms.get(user.roomId);
            if (room) {
                // 从房间中移除玩家
                room.players = room.players.filter(p => p.socketId !== socket.id);
                
                if (room.players.length === 0) {
                    // 房间为空，删除房间
                    rooms.delete(user.roomId);
                } else {
                    // 通知房间内其他玩家
                    io.to(user.roomId).emit('playerLeft', {
                        socketId: socket.id,
                        username: user.username
                    });
                }
            }
            
            // 清除用户信息
            users.delete(socket.id);
            
            console.log(`${user.username} 断开了连接`);
        } else {
            console.log(`用户 ${socket.id} 断开了连接`);
        }
    });
});

// 启动服务器
const PORT = process.env.PORT || 1983;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log(`服务器可通过网络访问: http://${getLocalIP()}:${PORT}`);
});

// 获取本地IP地址
function getLocalIP() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    
    for (const interfaceName in interfaces) {
        const interface = interfaces[interfaceName];
        for (const iface of interface) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}
