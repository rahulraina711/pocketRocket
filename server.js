const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
// Generate fixed buildings once on server start
const buildings = [];
for (let i = 0; i < 50; i++) {
    buildings.push({
        x: (Math.random() - 0.5) * 1000,
        z: (Math.random() - 0.5) * 1000,
        w: 30 + Math.random() * 50, // Width
        h: 50 + Math.random() * 150, // Height
        d: 30 + Math.random() * 50  // Depth
    });
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    players[socket.id] = {
        id: socket.id,
        x: (Math.random() - 0.5) * 500,
        y: 200, // Spawn higher up to avoid immediate crash
        z: (Math.random() - 0.5) * 500,
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        health: 100
    };

    socket.emit('currentPlayers', players);
    // Send building data to the new player
    socket.emit('initBuildings', buildings);
    socket.broadcast.emit('newPlayer', players[socket.id]);

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].z = movementData.z;
            players[socket.id].quaternion = movementData.quaternion;
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('shoot', (bulletData) => {
        io.emit('playerShot', { 
            ownerId: socket.id, 
            position: bulletData.position, 
            quaternion: bulletData.quaternion 
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

    // Handle crashes (Ground or Building)
    socket.on('playerCrashed', () => {
        if (players[socket.id]) {
            respawnPlayer(socket.id);
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

function respawnPlayer(id) {
    if (players[id]) {
        // 1. Tell the specific player they died (to show UI)
        io.to(id).emit('youDied');
        
        // 2. Tell everyone else this player died (to remove their jet from screen temporarily)
        io.emit('playerDied', id);

        // 3. Wait 5 seconds, then reset and respawn
        setTimeout(() => {
            if (players[id]) { // Check if player is still connected
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

http.listen(3000, () => {
    console.log('Server running on port 3000');
});