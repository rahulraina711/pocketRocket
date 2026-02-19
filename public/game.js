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

// Floor
const floorGeometry = new THREE.PlaneGeometry(2000, 2000);
const floorMaterial = new THREE.MeshBasicMaterial({ color: 0x228B22, side: THREE.DoubleSide });
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = Math.PI / 2;
scene.add(floor);

// Boundaries
const boundarySize = 2000;
const skyLimit = 800;
const boundaryGeo = new THREE.BoxGeometry(boundarySize, skyLimit, boundarySize);
const boundaryEdges = new THREE.EdgesGeometry(boundaryGeo);
const boundaryMat = new THREE.LineBasicMaterial({ color: 0xff0000 });
const boundaryLines = new THREE.LineSegments(boundaryEdges, boundaryMat);
boundaryLines.position.y = skyLimit / 2;
scene.add(boundaryLines);

// Game Variables
let myJet;
let otherPlayers = {};
let bullets = [];
let buildingMeshes = []; 
let buildingBoxes = [];
let coinMeshes = {}; 
let isDead = false;
let gameStarted = false;
let isGameOver = false;

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
    socket.emit('joinGame', name);
    gameStarted = true;
});

// --- Coin Logic ---
// Big Coins (Radius 6, Height 1.5)
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
    if (coinMeshes[id]) {
        scene.remove(coinMeshes[id]);
        delete coinMeshes[id];
    }
}

// --- Socket Events ---
socket.on('initBuildings', (data) => createBuildings(data));
socket.on('initCoins', (coins) => { Object.values(coins).forEach(c => addCoin(c)); });
socket.on('newCoin', (coin) => addCoin(coin));
socket.on('removeCoin', (id) => removeCoin(id));

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
        if (id === socket.id) addMyJet(players[id]);
        else addOtherJet(players[id]);
    });
});

socket.on('newPlayer', (playerInfo) => addOtherJet(playerInfo));
socket.on('playerDisconnected', (id) => {
    if (otherPlayers[id]) {
        scene.remove(otherPlayers[id]);
        delete otherPlayers[id];
    }
});
socket.on('playerMoved', (playerInfo) => {
    if (otherPlayers[playerInfo.id]) {
        otherPlayers[playerInfo.id].position.set(playerInfo.x, playerInfo.y, playerInfo.z);
        const targetQuat = new THREE.Quaternion(playerInfo.quaternion._x, playerInfo.quaternion._y, playerInfo.quaternion._z, playerInfo.quaternion._w);
        otherPlayers[playerInfo.id].quaternion.slerp(targetQuat, 0.5);
    }
});
socket.on('playerShot', (data) => createBullet(data.position, data.quaternion, data.ownerId));
socket.on('updateHealth', (data) => {
    if (data.id === socket.id) {
        document.getElementById('health').innerText = data.health;
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
        if (myJet) {
            myJet.visible = true;
            myJet.position.set(data.x, data.y, data.z);
            myJet.rotation.set(0, 0, 0); 
            myJet.quaternion.set(0, 0, 0, 1);
        }
        document.getElementById('health').innerText = 100;
        currentSpeed = 1.0;
    } else if (otherPlayers[data.id]) {
        otherPlayers[data.id].visible = true;
        otherPlayers[data.id].position.set(data.x, data.y, data.z);
    }
});
socket.on('clearCoins', () => {
    for (let id in coinMeshes) {
        scene.remove(coinMeshes[id]);
    }
    coinMeshes = {};
});
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
        if (countdown <= 0) {
            clearInterval(interval);
            screen.style.display = 'none';
            isGameOver = false; // Allow movement again
        }
    }, 1000);
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
    const matMissile = new THREE.MeshPhongMaterial({ color: 0xffffff });

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
    const iIGeo = new THREE.PlaneGeometry(0.5, 0.7);
    const iIL = new THREE.Mesh(iIGeo, matDark); iIL.position.set(-0.9, 0, -1.76); iIL.rotation.y = Math.PI; group.add(iIL);
    const iIR = new THREE.Mesh(iIGeo, matDark); iIR.position.set(0.9, 0, -1.76); iIR.rotation.y = Math.PI; group.add(iIR);

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

    const exGeo = new THREE.CylinderGeometry(0.5, 0.3, 0.5, 12); exGeo.rotateX(Math.PI/2);
    const exL = new THREE.Mesh(exGeo, matDark); exL.position.set(-0.5, 0, 2.75); group.add(exL);
    const exR = new THREE.Mesh(exGeo, matDark); exR.position.set(0.5, 0, 2.75); group.add(exR);
    const gGeo = new THREE.CylinderGeometry(0.25, 0.1, 0.1, 8); gGeo.rotateX(Math.PI/2);
    const gL = new THREE.Mesh(gGeo, matGlow); gL.position.set(-0.5, 0, 2.8); group.add(gL);
    const gR = new THREE.Mesh(gGeo, matGlow); gR.position.set(0.5, 0, 2.8); group.add(gR);

    const mGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.5, 8); mGeo.rotateX(Math.PI/2);
    const mhGeo = new THREE.ConeGeometry(0.08, 0.3, 8); mhGeo.rotateX(Math.PI/2); mhGeo.translate(0, 0, -0.9);
    const m1 = new THREE.Mesh(mGeo, matMissile); m1.add(new THREE.Mesh(mhGeo, matMissile)); m1.position.set(-2.5, -0.2, 0.5); group.add(m1);
    const m2 = m1.clone(); m2.position.set(2.5, -0.2, 0.5); group.add(m2);

    if (typeof createNameLabel === "function") {
        const label = createNameLabel(name); 
        label.position.set(0, 10, 0); // Raised name label
        group.add(label);
    }
    return group;
}

function createBuildings(data) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshPhongMaterial({ color: 0x555555 });
    data.forEach(b => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(b.x, b.h / 2, b.z);
        mesh.scale.set(b.w, b.h, b.d);
        scene.add(mesh);
        buildingMeshes.push(mesh);
        buildingBoxes.push(new THREE.Box3().setFromObject(mesh));
    });
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
    scene.add(jet);
    otherPlayers[playerInfo.id] = jet;
}
function createBullet(pos, quat, ownerId) {
    const geo = new THREE.SphereGeometry(0.2, 4, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const bullet = new THREE.Mesh(geo, mat);
    bullet.position.copy(pos);
    bullet.quaternion.set(quat._x, quat._y, quat._z, quat._w);
    bullet.ownerId = ownerId;
    scene.add(bullet);
    bullets.push({ mesh: bullet, life: 100 });
}

// --- Inputs & Collisions ---
window.addEventListener('keydown', (e) => { if (keys.hasOwnProperty(e.key)) keys[e.key] = true; });
window.addEventListener('keyup', (e) => { if (keys.hasOwnProperty(e.key)) keys[e.key] = false; });
window.addEventListener('mousedown', () => { 
    if (myJet && !isDead && !isGameOver && gameStarted) socket.emit('shoot', { position: myJet.position, quaternion: myJet.quaternion }); 
});

function checkCollisions() {
    if (!myJet || isDead || isGameOver) return;
    if (!myJet || isDead) return;

    // Coins
    for (let id in coinMeshes) {
        if (myJet.position.distanceTo(coinMeshes[id].position) < 15) { 
            socket.emit('collectCoin', id);
            removeCoin(id); 
        }
    }

    // World & Buildings
    if (myJet.position.y < 2) { socket.emit('playerCrashed'); return; }
    const limit = boundarySize / 2;
    if (Math.abs(myJet.position.x) > limit || Math.abs(myJet.position.z) > limit || myJet.position.y > skyLimit) {
        socket.emit('playerCrashed'); return;
    }
    const jetBox = new THREE.Box3().setFromObject(myJet);
    for (let box of buildingBoxes) {
        if (jetBox.intersectsBox(box)) { socket.emit('playerCrashed'); return; }
    }
}

// --- Loop ---
function animate() {
    requestAnimationFrame(animate);
    if (!gameStarted) return;

    if (myJet && !isDead && !isGameOver) {
        if (keys['w']) currentSpeed = Math.min(currentSpeed + 0.05, speedMax);
        if (keys['s']) currentSpeed = Math.max(currentSpeed - 0.05, speedMin);
        document.getElementById('speed').innerText = Math.round(currentSpeed * 10);
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

    // Rotate visual coins
    const time = Date.now() * 0.001;
    for (let id in coinMeshes) {
        coinMeshes[id].rotation.y += 0.02;
        coinMeshes[id].position.y += Math.sin(time * 2) * 0.05; 
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.mesh.translateZ(-5);
        b.life--;
        if (b.mesh.ownerId === socket.id && !isDead) {
            for (let id in otherPlayers) {
                const enemy = otherPlayers[id];
                if (enemy.visible && b.mesh.position.distanceTo(enemy.position) < 5) {
                    socket.emit('bulletHit', id);
                    b.life = 0; break;
                }
            }
        }
        if (b.life <= 0) { scene.remove(b.mesh); bullets.splice(i, 1); }
    }
    renderer.render(scene, camera);
}
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
animate();