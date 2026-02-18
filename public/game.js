const socket = io();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.Fog(0x87CEEB, 10, 900);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
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

// --- Map Boundaries (The Kill Box) ---
const boundarySize = 2000; // The map is 2000x2000
const skyLimit = 800;      // Max height

// Create a giant wireframe box to show the limits
const boundaryGeo = new THREE.BoxGeometry(boundarySize, skyLimit, boundarySize);
const boundaryEdges = new THREE.EdgesGeometry(boundaryGeo);
const boundaryMat = new THREE.LineBasicMaterial({ color: 0xff0000 }); // Red lines
const boundaryLines = new THREE.LineSegments(boundaryEdges, boundaryMat);

// Position it so the bottom touches the floor (y=0)
boundaryLines.position.y = skyLimit / 2; 
scene.add(boundaryLines);

// Game Variables
let myJet;
let otherPlayers = {};
let bullets = [];
let buildingMeshes = []; 
let buildingBoxes = [];

const speedMin = 0.5;
const speedMax = 5.0;
let currentSpeed = 1.0;
const turnSpeed = 0.04;
const turnSpeedPitchUp = 0.02
const turnSpeedPitchUDown = 0.005
let isDead = false; // New flag to disable controls

const keys = { w: false, s: false, ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };

// --- 3D Builder Functions ---
function createJetMesh(color) {
    const group = new THREE.Group();
    const bodyGeo = new THREE.ConeGeometry(1, 4, 8);
    bodyGeo.rotateX(Math.PI / 2);
    const bodyMat = new THREE.MeshPhongMaterial({ color: color });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);
    const wingGeo = new THREE.BoxGeometry(4, 0.1, 1.5);
    const wingMat = new THREE.MeshPhongMaterial({ color: 0x444444 });
    const wings = new THREE.Mesh(wingGeo, wingMat);
    group.add(wings);
    const tailGeo = new THREE.BoxGeometry(1.5, 0.1, 1);
    const tail = new THREE.Mesh(tailGeo, wingMat);
    tail.position.set(0, 0, 1.5);
    group.add(tail);
    const tailFinGeo = new THREE.BoxGeometry(0.1, 1, 1);
    const tailFin = new THREE.Mesh(tailFinGeo, wingMat);
    tailFin.position.set(0, 0.5, 1.5);
    group.add(tailFin);
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
        const box = new THREE.Box3().setFromObject(mesh);
        buildingBoxes.push(box);
    });
}

// --- Socket Events ---

socket.on('initBuildings', (data) => createBuildings(data));

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
        otherPlayers[playerInfo.id].quaternion.set(
            playerInfo.quaternion._x, playerInfo.quaternion._y, playerInfo.quaternion._z, playerInfo.quaternion._w
        );
    }
});

socket.on('playerShot', (data) => createBullet(data.position, data.quaternion, data.ownerId));

socket.on('updateHealth', (data) => {
    if (data.id === socket.id) {
        document.getElementById('health').innerText = data.health;
        myJet.children[0].material.color.setHex(0xff0000);
        setTimeout(() => myJet.children[0].material.color.setHex(0x00ff00), 100);
    }
});

// NEW: Handle Death UI
socket.on('youDied', () => {
    isDead = true;
    const screen = document.getElementById('death-screen');
    const timerSpan = document.getElementById('timer');
    screen.style.display = 'block';
    
    // Hide my jet locally while dead
    if(myJet) myJet.visible = false;

    let countdown = 5;
    timerSpan.innerText = countdown;
    
    const interval = setInterval(() => {
        countdown--;
        timerSpan.innerText = countdown;
        if (countdown <= 0) clearInterval(interval);
    }, 1000);
});

// NEW: Handle others dying
socket.on('playerDied', (id) => {
    if (otherPlayers[id]) {
        // We could play an explosion here
        otherPlayers[id].visible = false; // Hide them until respawn
    }
});

socket.on('respawn', (data) => {
    // If it's me
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
    } 
    // If it's someone else
    else if (otherPlayers[data.id]) {
        otherPlayers[data.id].visible = true;
        otherPlayers[data.id].position.set(data.x, data.y, data.z);
    }
});

function addMyJet(playerInfo) {
    myJet = createJetMesh(0x00ff00);
    myJet.position.set(playerInfo.x, playerInfo.y, playerInfo.z);
    scene.add(myJet);
}

function addOtherJet(playerInfo) {
    const jet = createJetMesh(0xff0000);
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

// --- Inputs ---
window.addEventListener('keydown', (e) => { if (keys.hasOwnProperty(e.key)) keys[e.key] = true; });
window.addEventListener('keyup', (e) => { if (keys.hasOwnProperty(e.key)) keys[e.key] = false; });
window.addEventListener('mousedown', () => {
    // Cannot shoot if dead
    if (myJet && !isDead) socket.emit('shoot', { position: myJet.position, quaternion: myJet.quaternion });
});

// --- Collision Logic ---
function checkCollisions() {
    if (!myJet || isDead) return; 

    // 1. Ground Collision
    if (myJet.position.y < 2) {
        socket.emit('playerCrashed');
        return; 
    }

    // 2. Map Boundary Collision (New)
    const limit = 1000; // Half of 2000 (from center 0)
    
    if (Math.abs(myJet.position.x) > limit ||  // Too far X
        Math.abs(myJet.position.z) > limit ||  // Too far Z
        myJet.position.y > skyLimit) {         // Too high
        
        console.log("Left the mission area!");
        socket.emit('playerCrashed');
        return;
    }

    // 3. Building Collision
    const jetBox = new THREE.Box3().setFromObject(myJet);
    for (let box of buildingBoxes) {
        if (jetBox.intersectsBox(box)) {
            socket.emit('playerCrashed');
            return;
        }
    }
}

// --- Main Loop ---
function animate() {
    requestAnimationFrame(animate);

    // Only move if jet exists and player is NOT dead
    if (myJet && !isDead) {
        if (keys['w']) currentSpeed = Math.min(currentSpeed + 0.05, speedMax);
        if (keys['s']) currentSpeed = Math.max(currentSpeed - 0.05, speedMin);
        document.getElementById('speed').innerText = Math.round(currentSpeed * 10);

        if (keys['ArrowUp']) myJet.rotateX(-turnSpeedPitchUp);
        if (keys['ArrowDown']) myJet.rotateX(turnSpeedPitchUDown);
        if (keys['ArrowLeft']) myJet.rotateZ(turnSpeed);
        if (keys['ArrowRight']) myJet.rotateZ(-turnSpeed);

        myJet.translateZ(-currentSpeed);

        const relativeCameraOffset = new THREE.Vector3(0, 10, 25);
        const cameraOffset = relativeCameraOffset.applyMatrix4(myJet.matrixWorld);
        camera.position.lerp(cameraOffset, 0.1);
        camera.lookAt(myJet.position);

        socket.emit('playerMovement', {
            x: myJet.position.x,
            y: myJet.position.y,
            z: myJet.position.z,
            quaternion: myJet.quaternion
        });

        checkCollisions();
    }

    // Bullets (Always update bullets so they don't freeze when I die)
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.mesh.translateZ(-5);
        b.life--;
        // Only calculate hits if I am alive and I own the bullet
        if (b.mesh.ownerId === socket.id && !isDead) {
            for (let id in otherPlayers) {
                const enemy = otherPlayers[id];
                // Simple check if enemy is visible (alive)
                if (enemy.visible && b.mesh.position.distanceTo(enemy.position) < 5) {
                    socket.emit('bulletHit', id);
                    b.life = 0;
                    break;
                }
            }
        }
        if (b.life <= 0) {
            scene.remove(b.mesh);
            bullets.splice(i, 1);
        }
    }

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();