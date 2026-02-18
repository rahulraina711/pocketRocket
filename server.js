const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let coins = {}; // Store coins here

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

// Generate Initial Coins
function spawnCoin() {
    const id = Math.random().toString(36).substr(2, 9);
    coins[id] = {
        id: id,
        x: (Math.random() - 0.5) * 1000,
        y: 50 + Math.random() * 300, // Random height
        z: (Math.random() - 0.5) * 1000
    };
    return coins[id];
}

// Create 50 coins to start
for(let i=0; i<50; i++) spawnCoin();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Send world data
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
            score: 0, // Init Score
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

    // NEW: Handle Coin Collection
    socket.on('collectCoin', (coinId) => {
        // Check if coin still exists (prevents double collecting)
        if (coins[coinId] && players[socket.id]) {
            delete coins[coinId]; // Remove from server
            
            // Give points
            players[socket.id].score += 100;
            
            // Tell everyone to remove coin
            io.emit('removeCoin', coinId);
            
            // Update Leaderboard
            io.emit('updateLeaderboard', getLeaderboard());

            // Spawn a replacement coin to keep the map full
            const newCoin = spawnCoin();
            io.emit('newCoin', newCoin);
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
        .sort((a, b) => b.score - a.score) // Sort highest first
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

http.listen(3000, () => { console.log('Server running on port 3000'); });