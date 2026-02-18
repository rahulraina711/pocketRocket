const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
const buildings = [];

// Generate buildings once
for (let i = 0; i < 50; i++) {
    buildings.push({
        x: (Math.random() - 0.5) * 1000,
        z: (Math.random() - 0.5) * 1000,
        w: 30 + Math.random() * 50,
        h: 50 + Math.random() * 150,
        d: 30 + Math.random() * 50
    });
}

io.on('connection', (socket) => {
    console.log('User connected (Waiting for login):', socket.id);

    // Send buildings immediately so they can load the map
    socket.emit('initBuildings', buildings);

    // 1. Listen for "joinGame" before creating the player
    socket.on('joinGame', (name) => {
        console.log(`Player Joined: ${name} (${socket.id})`);

        players[socket.id] = {
            id: socket.id,
            name: name, // Store the name
            x: (Math.random() - 0.5) * 500,
            y: 200,
            z: (Math.random() - 0.5) * 500,
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
            health: 100,
            color: Math.random() * 0xffffff
        };

        // Send existing players to the new guy
        socket.emit('currentPlayers', players);
        
        // Notify others about the new guy (including name)
        socket.broadcast.emit('newPlayer', players[socket.id]);
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
        io.emit('playerShot', { 
            ownerId: socket.id, 
            position: data.position, 
            quaternion: data.quaternion 
        });
    });

    socket.on('bulletHit', (targetId) => {
        if (players[targetId]) {
            players[targetId].health -= 10;
            io.emit('updateHealth', { id: targetId, health: players[targetId].health });

            if (players[targetId].health <= 0) {
                respawnPlayer(targetId);
            }
        }
    });

    socket.on('playerCrashed', () => {
        if (players[socket.id]) respawnPlayer(socket.id);
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            console.log(`Player Left: ${players[socket.id].name}`);
            delete players[socket.id];
            io.emit('playerDisconnected', socket.id);
        }
    });
});

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