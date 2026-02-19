const socket = io();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.Fog(0x87CEEB, 10, 900);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 3000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(100, 100, 50);
scene.add(dirLight);

// --- Procedural Terrain ---
function getTerrainHeight(x, z) {
    let height = Math.sin(x * 0.004) * Math.cos(z * 0.004) * 150;
    height += Math.sin(x * 0.015) * Math.cos(z * 0.01) * 40;
    const distFromCenter = Math.sqrt(x*x + z*z);
    if (distFromCenter < 300) height *= (distFromCenter / 300);
    return height - 20; 
}

const terrainGeo = new THREE.PlaneGeometry(2000, 2000, 80, 80);
terrainGeo.rotateX(-Math.PI / 2);
const pos = terrainGeo.attributes.position;
for (let i = 0; i < pos.count; i++) {
    pos.setY(i, getTerrainHeight(pos.getX(i), pos.getZ(i)));
}
terrainGeo.computeVertexNormals(); 

const terrainMat = new THREE.MeshPhongMaterial({ color: 0x2d5a27, flatShading: true, shininess: 0 });
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
scene.add(terrain);

const boundarySize = 2000;
const skyLimit = 800;

// --- Game Variables ---
let myJet;
let otherPlayers = {};
let coinMeshes = {}; 
let isDead = false;
let gameStarted = false;
let isGameOver = false;

// --- Combat Variables ---
let missiles = [];
let activeFlares = [];
let explosions = [];
let myFlares = 3;         
let flareCooldown = 0;    
let missileCooldown = 0;
const missileAimHelper = new THREE.Object3D(); 

const speedMin = 0.5;
const speedMax = 5.0;
let currentSpeed = 1.0;
const turnSpeed = 0.04;

const keys = { w: false, s: false, ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };

// --- Setup ---
document.getElementById('start-btn').addEventListener('click', () => {
    const nameInput = document.getElementById('username');
    const name = nameInput.value.trim() || "Pilot";
    document.getElementById('login-screen').style.display = 'none';
    
    document.getElementById('ui').innerHTML = `
        <div style="margin-bottom: 5px; font-size: 18px;">HULL INTEGRITY</div>
        <div style="width: 250px; height: 20px; background: rgba(255, 0, 0, 0.4); border: 2px solid white; border-radius: 5px; box-shadow: 0 0 5px black;">
            <div id="health-bar" style="width: 100%; height: 100%; background: #00ff00; transition: width 0.3s ease-in-out, background-color 0.3s;"></div>
        </div>
        <div style="margin-top: 15px; font-size: 18px;">Speed: <span id="speed">0</span></div>
        <div style="margin-top: 10px; font-size: 18px; color: #ffaa00;" id="flare-ui">Flares: <span id="flare-count">3</span> [SPACE]</div>
        <div style="margin-top: 5px; font-size: 18px; color: #ffffff;" id="missile-ui">Missile: READY [F]</div>
    `;
    
    document.getElementById('controls-hint').innerHTML = `
        <b>Controls:</b><br>
        W / S: Accelerate / Decelerate<br>
        UP / DOWN: Pitch | LEFT / RIGHT: Roll<br>
        F: Fire Homing Missile<br>
        SPACE: Deploy Flare
    `;
    
    socket.emit('joinGame', name);
    gameStarted = true;
});

// --- Coin Logic ---
const coinGeo = new THREE.CylinderGeometry(6, 6, 1.5, 32);
coinGeo.rotateX(Math.PI / 2); 
const coinMat = new THREE.MeshPhongMaterial({ color: 0xffd700, shininess: 100 });

function addCoin(data) {
    const mesh = new THREE.Mesh(coinGeo, coinMat);
    mesh.position.set(data.x, data.y, data.z);
    scene.add(mesh);
    coinMeshes[data.id] = mesh;
}
function removeCoin(id) {
    if (coinMeshes[id]) { scene.remove(coinMeshes[id]); delete coinMeshes[id]; }
}

// --- Socket Listeners ---
socket.on('initCoins', (coins) => { Object.values(coins).forEach(c => addCoin(c)); });
socket.on('newCoin', (coin) => addCoin(coin));
socket.on('removeCoin', (id) => removeCoin(id));
socket.on('clearCoins', () => { for (let id in coinMeshes) scene.remove(coinMeshes[id]); coinMeshes = {}; });

socket.on('gameOver', (winnerName) => {
    isGameOver = true;
    const screen = document.getElementById('win-screen');
    document.getElementById('winner-name').innerText = winnerName + " WINS!";
    screen.style.display = 'block';
    let countdown = 5;
    document.getElementById('win-timer').innerText = countdown;
    const interval = setInterval(() => {
        countdown--;
        document.getElementById('win-timer').innerText = countdown;
        if (countdown <= 0) { clearInterval(interval); screen.style.display = 'none'; isGameOver = false; }
    }, 1000);
});

socket.on('updateLeaderboard', (data) => {
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = "";
    data.forEach(p => {
        const div = document.createElement('div');
        div.style.marginBottom = "5px";
        div.innerText = `${p.name}: ${p.score}`;
        list.appendChild(div);
    });
});

socket.on('currentPlayers', (players) => {
    Object.keys(players).forEach((id) => {
        if (id === socket.id) addMyJet(players[id]); else addOtherJet(players[id]);
    });
});
socket.on('newPlayer', (playerInfo) => addOtherJet(playerInfo));
socket.on('playerDisconnected', (id) => { if (otherPlayers[id]) { scene.remove(otherPlayers[id]); delete otherPlayers[id]; } });

socket.on('playerMoved', (playerInfo) => {
    if (otherPlayers[playerInfo.id]) {
        otherPlayers[playerInfo.id].targetPosition.set(playerInfo.x, playerInfo.y, playerInfo.z);
        otherPlayers[playerInfo.id].targetQuaternion.set(playerInfo.quaternion._x, playerInfo.quaternion._y, playerInfo.quaternion._z, playerInfo.quaternion._w);
    }
});

// --- Combat Socket Listeners ---
socket.on('missileFired', (data) => {
    // Only spawn incoming network missiles if you aren't the one who shot it!
    if (data.ownerId !== socket.id) {
        createMissile(data.position, data.quaternion, data.ownerId);
    }
});
socket.on('flareDeployed', (pos) => spawnFlare(pos));

socket.on('updateHealth', (data) => {
    if (data.id === socket.id) {
        const healthBar = document.getElementById('health-bar');
        if(healthBar) {
            healthBar.style.width = Math.max(0, data.health) + '%';
            if (data.health > 50) healthBar.style.background = '#00ff00';
            else if (data.health > 25) healthBar.style.background = '#ffff00';
            else healthBar.style.background = '#ff0000';
        }
        if(myJet) {
            myJet.children[0].material.color.setHex(0xff0000);
            setTimeout(() => myJet.children[0].material.color.setHex(0x00ff00), 100);
        }
    }
});

socket.on('youDied', () => {
    isDead = true;
    document.getElementById('death-screen').style.display = 'block';
    if(myJet) myJet.visible = false;
    let countdown = 5;
    document.getElementById('timer').innerText = countdown;
    const interval = setInterval(() => {
        countdown--;
        document.getElementById('timer').innerText = countdown;
        if (countdown <= 0) clearInterval(interval);
    }, 1000);
});

socket.on('playerDied', (id) => { if (otherPlayers[id]) otherPlayers[id].visible = false; });

socket.on('respawn', (data) => {
    if (data.id === socket.id) {
        isDead = false;
        document.getElementById('death-screen').style.display = 'none';
        
        const healthBar = document.getElementById('health-bar');
        if(healthBar) {
            healthBar.style.width = '100%';
            healthBar.style.background = '#00ff00';
        }
        myFlares = 3;
        flareCooldown = 0;
        const flareUI = document.getElementById('flare-count');
        if(flareUI) flareUI.innerText = myFlares;

        if (myJet) {
            myJet.visible = true;
            myJet.position.set(data.x, data.y, data.z);
            myJet.rotation.set(0, 0, 0); 
            myJet.quaternion.set(0, 0, 0, 1);
        }
        currentSpeed = 1.0;
    } else if (otherPlayers[data.id]) {
        otherPlayers[data.id].visible = true;
        otherPlayers[data.id].targetPosition.set(data.x, data.y, data.z);
    }
});

// --- Builder Functions ---
function createNameLabel(name) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = 'Bold 24px Arial';
    context.fillStyle = 'white';
    context.strokeStyle = 'black';
    context.lineWidth = 4;
    const textWidth = context.measureText(name).width;
    canvas.width = textWidth + 20; canvas.height = 40;
    context.font = 'Bold 24px Arial';
    context.fillStyle = 'white';
    context.strokeStyle = 'black';
    context.lineWidth = 4;
    context.strokeText(name, 10, 30);
    context.fillText(name, 10, 30);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
    sprite.scale.set(10, 5, 1); 
    return sprite;
}

function createJetMesh(color, name) {
    const group = new THREE.Group();
    const matBody = new THREE.MeshPhongMaterial({ color: color, flatShading: true, shininess: 50 });
    const matGrey = new THREE.MeshPhongMaterial({ color: 0x555555, flatShading: true });
    const matDark = new THREE.MeshPhongMaterial({ color: 0x222222, flatShading: true });
    const matGlass = new THREE.MeshPhongMaterial({ color: 0x00aaff, opacity: 0.6, transparent: true, shininess: 100 });
    const matGlow = new THREE.MeshBasicMaterial({ color: 0xffaa00 });

    const fuselageGeo = new THREE.BoxGeometry(1.2, 1, 5);
    const fusPos = fuselageGeo.attributes.position;
    for(let i=0; i<fusPos.count; i++){
        if(fusPos.getZ(i) < -1) { fusPos.setX(i, fusPos.getX(i)*0.7); fusPos.setY(i, fusPos.getY(i)*0.7); }
    }
    fuselageGeo.computeVertexNormals();
    group.add(new THREE.Mesh(fuselageGeo, matBody));

    const noseGeo = new THREE.ConeGeometry(0.5, 2.5, 8); noseGeo.rotateX(Math.PI/2);
    const nose = new THREE.Mesh(noseGeo, matGrey); nose.position.z = -3.75; group.add(nose);

    const cockpitGeo = new THREE.BoxGeometry(0.9, 0.6, 1.8);
    const cockPos = cockpitGeo.attributes.position;
    for(let i=0; i<cockPos.count; i++){
        if(cockPos.getY(i) > 0) cockPos.setX(i, cockPos.getX(i)*0.7);
        if(cockPos.getZ(i) < 0) cockPos.setY(i, cockPos.getY(i)*0.4);
    }
    cockpitGeo.computeVertexNormals();
    const cockpit = new THREE.Mesh(cockpitGeo, matGlass); cockpit.position.set(0, 0.6, -1.0); group.add(cockpit);

    const intakeGeo = new THREE.BoxGeometry(0.6, 0.8, 2.5);
    const iL = new THREE.Mesh(intakeGeo, matBody); iL.position.set(-0.9, 0, -0.5); group.add(iL);
    const iR = new THREE.Mesh(intakeGeo, matBody); iR.position.set(0.9, 0, -0.5); group.add(iR);
    
    const wingGeo = new THREE.BoxGeometry(4, 0.1, 2.5);
    const wPos = wingGeo.attributes.position;
    for(let i=0; i<wPos.count; i++){
        wPos.setZ(i, wPos.getZ(i) + Math.abs(wPos.getX(i))*0.8);
        if(Math.abs(wPos.getX(i))>1) wPos.setY(i, wPos.getY(i)*0.2);
    }
    wingGeo.computeVertexNormals();
    const wings = new THREE.Mesh(wingGeo, matBody); wings.position.set(0, 0, 0.5); group.add(wings);

    const tailGeo = new THREE.BoxGeometry(0.1, 1.8, 1.5);
    const tPos = tailGeo.attributes.position;
    for(let i=0; i<tPos.count; i++){ if(tPos.getY(i)>0) { tPos.setZ(i, tPos.getZ(i)+1.2); tPos.setZ(i, tPos.getZ(i)*0.7); } }
    tailGeo.computeVertexNormals();
    const tL = new THREE.Mesh(tailGeo, matBody); tL.position.set(-0.7, 0.8, 2); tL.rotation.z = Math.PI/12; group.add(tL);
    const tR = new THREE.Mesh(tailGeo, matBody); tR.position.set(0.7, 0.8, 2); tR.rotation.z = -Math.PI/12; group.add(tR);

    const eGeo = new THREE.BoxGeometry(2.5, 0.1, 1.2);
    const ePos = eGeo.attributes.position;
    for(let i=0; i<ePos.count; i++) ePos.setZ(i, ePos.getZ(i)+Math.abs(ePos.getX(i))*0.5);
    eGeo.computeVertexNormals();
    const elev = new THREE.Mesh(eGeo, matBody); elev.position.set(0, 0, 2.2); group.add(elev);

    if (typeof createNameLabel === "function") {
        const label = createNameLabel(name); label.position.set(0, 10, 0); group.add(label);
    }
    return group;
}

function addMyJet(playerInfo) {
    myJet = createJetMesh(playerInfo.color, playerInfo.name);
    myJet.position.set(playerInfo.x, playerInfo.y, playerInfo.z);
    scene.add(myJet);
}

function addOtherJet(playerInfo) {
    const jet = createJetMesh(playerInfo.color, playerInfo.name);
    jet.position.set(playerInfo.x, playerInfo.y, playerInfo.z);
    jet.playerId = playerInfo.id;
    jet.targetPosition = new THREE.Vector3(playerInfo.x, playerInfo.y, playerInfo.z);
    jet.targetQuaternion = new THREE.Quaternion(0, 0, 0, 1);
    scene.add(jet);
    otherPlayers[playerInfo.id] = jet;
}

// --- Visual Combat Elements ---
function createMissile(pos, quat, ownerId) {
    const group = new THREE.Group();
    
    // Missile Body
    const bodyGeo = new THREE.CylinderGeometry(0.3, 0.3, 3, 8);
    bodyGeo.rotateX(Math.PI / 2);
    const bodyMat = new THREE.MeshPhongMaterial({ color: 0xffffff });
    group.add(new THREE.Mesh(bodyGeo, bodyMat));
    
    // Missile Head (Red Tip)
    const headGeo = new THREE.ConeGeometry(0.3, 0.8, 8);
    headGeo.rotateX(Math.PI / 2);
    // THE FIX: Use .translate() instead of .position
    headGeo.translate(0, 0, -1.9); 
    const headMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    group.add(new THREE.Mesh(headGeo, headMat));

    // Safely apply position and rotation
    group.position.set(pos.x, pos.y, pos.z);
    group.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    
    // Spawn just in front of the nose so it doesn't clip into you
    group.translateZ(-4); 
    scene.add(group);
    
    missiles.push({ mesh: group, ownerId: ownerId, life: 600 }); 
}

function spawnFlare(pos) {
    const geo = new THREE.SphereGeometry(1, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.8 });
    const flare = new THREE.Mesh(geo, mat);
    flare.position.copy(pos);
    scene.add(flare);
    activeFlares.push({ mesh: flare, life: 180 });
}

function createExplosion(pos) {
    const geo = new THREE.SphereGeometry(2, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff4500, transparent: true, opacity: 1 });
    const explosion = new THREE.Mesh(geo, mat);
    explosion.position.copy(pos);
    scene.add(explosion);
    
    // Explosion lasts for half a second (30 frames)
    explosions.push({ mesh: explosion, life: 30 }); 
}

// --- Inputs ---
document.addEventListener('keydown', (e) => { 
    if (keys.hasOwnProperty(e.key)) keys[e.key] = true; 
    
    const key = e.key.toLowerCase();
    
    // Deploy Flares
    if (e.code === 'Space' && myJet && !isDead && !isGameOver) {
        if (myFlares > 0 && flareCooldown <= 0) {
            myFlares--;
            flareCooldown = 3.0;
            const ui = document.getElementById('flare-count');
            if(ui) ui.innerText = myFlares;
            const dropPos = new THREE.Vector3(0, -2, 3).applyMatrix4(myJet.matrixWorld);
            socket.emit('deployFlare', dropPos);
        }
    }

    // Fire Homing Missile (Instant Client-Side Spawning)
    if (key === 'f' && myJet && !isDead && !isGameOver && gameStarted) {
        if (missileCooldown <= 0) { 
            missileCooldown = 1.0; 
            
            const misUI = document.getElementById('missile-ui');
            if(misUI) { misUI.innerText = "Missile: FIRED!"; misUI.style.color = "#ff0000"; }
            
            const pos = { x: myJet.position.x, y: myJet.position.y, z: myJet.position.z };
            const quat = { x: myJet.quaternion.x, y: myJet.quaternion.y, z: myJet.quaternion.z, w: myJet.quaternion.w };
            
            // 1. SPAWN INSTANTLY FOR YOURSELF (Zero Lag)
            createMissile(pos, quat, socket.id);

            // 2. TELL THE SERVER TO SPAWN IT FOR EVERYONE ELSE
            socket.emit('fireMissile', { position: pos, quaternion: quat }); 
        }
    }
});
document.addEventListener('keyup', (e) => { if (keys.hasOwnProperty(e.key)) keys[e.key] = false; });

function checkCollisions() {
    if (!myJet || isDead || isGameOver) return;
    
    for (let id in coinMeshes) {
        if (myJet.position.distanceTo(coinMeshes[id].position) < 15) { 
            socket.emit('collectCoin', id); removeCoin(id); 
        }
    }
    
    const groundHeight = getTerrainHeight(myJet.position.x, myJet.position.z);
    if (myJet.position.y < groundHeight + 2) { 
        socket.emit('playerCrashed'); return; 
    }
    
    const limit = boundarySize / 2;
    if (Math.abs(myJet.position.x) > limit || Math.abs(myJet.position.z) > limit || myJet.position.y > skyLimit) {
        socket.emit('playerCrashed'); return;
    }
}

// --- Main Loop ---
function animate() {
    requestAnimationFrame(animate);
    if (!gameStarted) return;

    if (flareCooldown > 0) { flareCooldown -= 1/60; if (flareCooldown <= 0) flareCooldown = 0; }
    
    if (missileCooldown > 0) { 
        missileCooldown -= 1/60; 
        if (missileCooldown <= 0) {
            missileCooldown = 0;
            const misUI = document.getElementById('missile-ui');
            if(misUI) { misUI.innerText = "Missile: READY [F]"; misUI.style.color = "#ffffff"; }
        }
    }

    if (myJet && !isDead && !isGameOver) {
        if (keys['w']) currentSpeed = Math.min(currentSpeed + 0.05, speedMax);
        if (keys['s']) currentSpeed = Math.max(currentSpeed - 0.05, speedMin);
        const speedUI = document.getElementById('speed');
        if(speedUI) speedUI.innerText = Math.round(currentSpeed * 10);
        
        if (keys['ArrowUp']) myJet.rotateX(-turnSpeed);
        if (keys['ArrowDown']) myJet.rotateX(turnSpeed);
        if (keys['ArrowLeft']) myJet.rotateZ(turnSpeed);
        if (keys['ArrowRight']) myJet.rotateZ(-turnSpeed);
        myJet.translateZ(-currentSpeed);

        const relativeCameraOffset = new THREE.Vector3(0, 10, 25);
        const cameraOffset = relativeCameraOffset.applyMatrix4(myJet.matrixWorld);
        camera.position.lerp(cameraOffset, 0.1);
        camera.lookAt(myJet.position);

        socket.emit('playerMovement', { x: myJet.position.x, y: myJet.position.y, z: myJet.position.z, quaternion: myJet.quaternion });
        checkCollisions();
    }

    for (let id in otherPlayers) {
        const enemy = otherPlayers[id];
        if (enemy.targetPosition && enemy.visible) {
            enemy.position.lerp(enemy.targetPosition, 0.2);
            enemy.quaternion.slerp(enemy.targetQuaternion, 0.2);
        }
    }

    const time = Date.now() * 0.001;
    for (let id in coinMeshes) {
        coinMeshes[id].rotation.y += 0.02;
        coinMeshes[id].position.y += Math.sin(time * 2) * 0.05; 
    }

    for (let i = activeFlares.length - 1; i >= 0; i--) {
        const f = activeFlares[i];
        f.mesh.position.y -= 0.5; 
        f.life--;
        f.mesh.material.opacity = (f.life % 10 < 5) ? 1.0 : 0.4;
        if (f.life <= 0) { scene.remove(f.mesh); activeFlares.splice(i, 1); }
    }

    // --- The Homing Missile Logic ---
    for (let i = missiles.length - 1; i >= 0; i--) {
        const m = missiles[i];
        m.life--;
        
        let targetPos = null;
        let scanRadius = 300; // Increased tracking scan radius

        // 1. Flare Distraction
        for (let f of activeFlares) {
            if (m.mesh.position.distanceTo(f.mesh.position) < 150) { 
                targetPos = f.mesh.position; 
                break; 
            }
        }

        // 2. Enemy Proximity Scan
        if (!targetPos) {
            for (let id in otherPlayers) {
                const enemy = otherPlayers[id];
                if (enemy.visible && m.ownerId !== enemy.playerId) {
                    let dist = m.mesh.position.distanceTo(enemy.position);
                    if (dist < scanRadius) {
                        scanRadius = dist;
                        targetPos = enemy.position;
                    }
                }
            }
            if (m.ownerId !== socket.id && !isDead) {
                let dist = m.mesh.position.distanceTo(myJet.position);
                if (dist < scanRadius) { targetPos = myJet.position; }
            }
        }

        // 3. Curve towards target
        if (targetPos) {
            missileAimHelper.position.copy(m.mesh.position);
            
            // This aligns the +Z axis to the target
            missileAimHelper.lookAt(targetPos);
            
            // THE FIX: Flip the math helper 180 degrees so its -Z axis (forward) faces the target!
            missileAimHelper.rotateY(Math.PI); 
            
            // Now the missile will smoothly steer its nose toward the enemy
            m.mesh.quaternion.slerp(missileAimHelper.quaternion, 0.3); 
        }

        // 4. Move forward SUPER FAST (10 units per frame vs Jet's max 5)
        m.mesh.translateZ(-4.5) 

        // 5. Check hits (Increased hit radius from 5 to 12 because of the high speed)
        // 5. Check hits (EVERYONE checks this to delete the visual missile)
        let hitTarget = false;
        
        // A. Check if it hit an enemy
        for (let id in otherPlayers) {
            const enemy = otherPlayers[id];
            if (enemy.visible && m.mesh.position.distanceTo(enemy.position) < 20) {
                hitTarget = true;
                // ONLY the shooter is allowed to send the damage event to the server
                if (m.ownerId === socket.id && !isDead) {
                    socket.emit('missileHit', id);
                }
                break;
            }
        }

        // B. Check if it hit YOU (so the victim also deletes the missile on their screen)
        if (!hitTarget && !isDead && m.mesh.position.distanceTo(myJet.position) < 20) {
            // Make sure you don't instantly blow yourself up with your own missile!
            if (m.ownerId !== socket.id) {
                hitTarget = true;
            }
        }

        // C. Delete the missile for everyone
        if (hitTarget) {
            createExplosion(m.mesh.position);
            m.life = 0; 
        }
        
        // 6. Blow up if it hits the ground
        const mGroundHeight = getTerrainHeight(m.mesh.position.x, m.mesh.position.z);
        if (m.mesh.position.y < mGroundHeight) {
            m.life = 0;
        }

        if (m.life <= 0) { scene.remove(m.mesh); missiles.splice(i, 1); }
    }

    // --- Animate Explosions (Hit Markers) ---
    for (let i = explosions.length - 1; i >= 0; i--) {
        const exp = explosions[i];
        exp.life--;
        
        // Rapidly grow the sphere and fade it out
        exp.mesh.scale.addScalar(0.4); 
        exp.mesh.material.opacity -= 0.033; 
        
        if (exp.life <= 0) { 
            scene.remove(exp.mesh); 
            explosions.splice(i, 1); 
        }
    }

    renderer.render(scene, camera);
}
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
animate();