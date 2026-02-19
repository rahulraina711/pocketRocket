const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let coins = {};

// Generate Buildings (Static)
const buildings = [];
for (let i = 0; i < 50; i++) {
    buildings.push({
        x: (Math.random() - 0.5) * 1000,
        z: (Math.random() - 0.5) * 1000,
        w: 30 + Math.random() * 50,
        h: 50 + Math.random() * 150,
        d: 30 + Math.random() * 50
    });
}

function spawnCoin() {
    const id = Math.random().toString(36).substr(2, 9);
    coins[id] = {
        id: id,
        x: (Math.random() - 0.5) * 1000,
        y: 50 + Math.random() * 300,
        z: (Math.random() - 0.5) * 1000
    };
    return coins[id];
}

// Create EXACTLY 10 coins to start
for(let i=0; i<10; i++) spawnCoin();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.emit('initBuildings', buildings);
    socket.emit('initCoins', coins);

    socket.on('joinGame', (name) => {
        players[socket.id] = {
            id: socket.id,
            name: name,
            x: (Math.random() - 0.5) * 500,
            y: 200,
            z: (Math.random() - 0.5) * 500,
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
            health: 100,
            score: 0, 
            color: Math.random() * 0xffffff
        };

        socket.emit('currentPlayers', players);
        socket.broadcast.emit('newPlayer', players[socket.id]);
        io.emit('updateLeaderboard', getLeaderboard());
    });

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].z = movementData.z;
            players[socket.id].quaternion = movementData.quaternion;
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('shoot', (data) => {
        io.emit('playerShot', { ownerId: socket.id, position: data.position, quaternion: data.quaternion });
    });

    socket.on('bulletHit', (targetId) => {
        if (players[targetId]) {
            players[targetId].health -= 10;
            io.emit('updateHealth', { id: targetId, health: players[targetId].health });
            if (players[targetId].health <= 0) respawnPlayer(targetId);
        }
    });

    // --- UPDATED COIN LOGIC ---
    socket.on('collectCoin', (coinId) => {
        if (coins[coinId] && players[socket.id]) {
            delete coins[coinId]; 
            
            players[socket.id].score += 100;
            io.emit('removeCoin', coinId);
            io.emit('updateLeaderboard', getLeaderboard());
            
            // Check for WIN CONDITION (1000 points)
            if (players[socket.id].score >= 1000) {
                // Tell everyone the game is over and who won
                io.emit('gameOver', players[socket.id].name);
                
                // Wait 5 seconds, then reset the game for everyone
                setTimeout(() => {
                    resetGame();
                }, 5000);
            } else {
                // Only spawn a replacement if the game isn't over
                const newCoin = spawnCoin();
                io.emit('newCoin', newCoin);
            }
        }
    });

    socket.on('playerCrashed', () => { if (players[socket.id]) respawnPlayer(socket.id); });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
        io.emit('updateLeaderboard', getLeaderboard());
    });
});

function getLeaderboard() {
    return Object.values(players)
        .sort((a, b) => b.score - a.score)
        .map(p => ({ name: p.name, score: p.score }));
}

function respawnPlayer(id) {
    if (players[id]) {
        io.to(id).emit('youDied');
        io.emit('playerDied', id);
        setTimeout(() => {
            if (players[id]) {
                players[id].health = 100;
                players[id].x = (Math.random() - 0.5) * 500;
                players[id].y = 200;
                players[id].z = (Math.random() - 0.5) * 500;
                players[id].quaternion = { x: 0, y: 0, z: 0, w: 1 };
                io.emit('respawn', players[id]);
            }
        }, 5000);
    }
}

// --- NEW GAME RESET LOGIC ---
function resetGame() {
    // 1. Reset all players
    Object.values(players).forEach(p => {
        p.score = 0;
        p.health = 100;
        p.x = (Math.random() - 0.5) * 500;
        p.y = 200;
        p.z = (Math.random() - 0.5) * 500;
        p.quaternion = { x: 0, y: 0, z: 0, w: 1 };
        // We can reuse the respawn event to reset their position on the client
        io.emit('respawn', p);
    });
    
    // 2. Clear Leaderboard
    io.emit('updateLeaderboard', getLeaderboard());

    // 3. Clear old coins and spawn 10 new ones
    coins = {};
    io.emit('clearCoins'); 
    for(let i=0; i<10; i++) spawnCoin();
    io.emit('initCoins', coins);
}

http.listen(3000, () => { console.log('Server running on port 3000'); });