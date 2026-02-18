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

// Game Variables
let myJet;
let otherPlayers = {};
let bullets = [];
let buildingMeshes = []; 
let buildingBoxes = []; // For collision detection

const speedMin = 0.5;
const speedMax = 5.0;
let currentSpeed = 1.0;
const turnSpeed = 0.04;

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
        mesh.position.set(b.x, b.h / 2, b.z); // y is half height so it sits on floor
        mesh.scale.set(b.w, b.h, b.d);
        scene.add(mesh);
        
        buildingMeshes.push(mesh);

        // Create a Box3 for collision detection
        const box = new THREE.Box3().setFromObject(mesh);
        buildingBoxes.push(box);
    });
}

// --- Socket Events ---

socket.on('initBuildings', (data) => {
    createBuildings(data);
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
        otherPlayers[playerInfo.id].quaternion.set(
            playerInfo.quaternion._x,
            playerInfo.quaternion._y,
            playerInfo.quaternion._z,
            playerInfo.quaternion._w
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

socket.on('respawn', (data) => {
    if (data.id === socket.id) {
        myJet.position.set(data.x, data.y, data.z);
        // Reset rotation to flat
        myJet.rotation.set(0, 0, 0); 
        document.getElementById('health').innerText = 100;
        currentSpeed = 1.0;
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
    if (myJet) socket.emit('shoot', { position: myJet.position, quaternion: myJet.quaternion });
});

// --- Collision Logic ---
function checkCollisions() {
    if (!myJet) return;

    // 1. Ground Collision
    // Jet radius is roughly 1-2 units, floor is at y=0
    if (myJet.position.y < 2) {
        console.log("Crashed into ground!");
        socket.emit('playerCrashed');
        return; 
    }

    // 2. Building Collision
    // We create a bounding box for the jet for this frame
    const jetBox = new THREE.Box3().setFromObject(myJet);

    for (let box of buildingBoxes) {
        if (jetBox.intersectsBox(box)) {
            console.log("Crashed into building!");
            socket.emit('playerCrashed');
            return;
        }
    }
}

// --- Main Loop ---
function animate() {
    requestAnimationFrame(animate);

    if (myJet) {
        if (keys['w']) currentSpeed = Math.min(currentSpeed + 0.05, speedMax);
        if (keys['s']) currentSpeed = Math.max(currentSpeed - 0.05, speedMin);
        document.getElementById('speed').innerText = Math.round(currentSpeed * 10);

        // Inverted Pitch (Up Arrow = Nose Down)
        if (keys['ArrowUp']) myJet.rotateX(-turnSpeed);
        if (keys['ArrowDown']) myJet.rotateX(turnSpeed);
        if (keys['ArrowLeft']) myJet.rotateZ(turnSpeed);
        if (keys['ArrowRight']) myJet.rotateZ(-turnSpeed);

        myJet.translateZ(-currentSpeed);

        // Camera Follow
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

        // Check for collisions
        checkCollisions();
    }

    // Bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.mesh.translateZ(-5);
        b.life--;
        if (b.mesh.ownerId === socket.id) {
            for (let id in otherPlayers) {
                const enemy = otherPlayers[id];
                if (b.mesh.position.distanceTo(enemy.position) < 5) {
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