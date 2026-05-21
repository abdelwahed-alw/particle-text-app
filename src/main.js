import * as THREE from 'three';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

let scene, camera, renderer;
let particleGeometry, particleSystem, particleMaterial;

const webcamElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');

const PARTICLE_COUNT = 15000;
const targetPositions = new Float32Array(PARTICLE_COUNT * 3);
const scatterPositions = new Float32Array(PARTICLE_COUNT * 3);

const words = ['VISION', 'LOGIC', 'EXECUTION', "LET'S BUILD", 'ABDELWAHED'];
const neonColors = [0x00f3ff, 0xff00ff, 0x00ff88, 0xffd700, 0xff3366];
let currentWordIndex = 0;

let handLandmarker;
let lastVideoTime = -1;
let gestureCooldown = false;
let wordChangeAllowed = true;

let isScattered = true;
let isSnapping = false;
let isEnteringPortal = false;

let handX_3D = 0;
let handY_3D = 0;
let isHandVisible = false;

let targetRotationX = 0;
let targetRotationY = 0;

const HAND_CONNECTIONS = [
    [0,1], [1,2], [2,3], [3,4], [0,5], [5,6], [6,7], [7,8],
    [5,9], [9,10], [10,11], [11,12], [9,13], [13,14], [14,15],
    [15,16], [13,17], [0,17], [17,18], [18,19], [19,20]
];

function initThree() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 60;
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(renderer.domElement);
    window.addEventListener('resize', onWindowResize);
}

function drawHand(landmarks) {
    canvasCtx.strokeStyle = '#' + neonColors[currentWordIndex].toString(16).padStart(6, '0');
    canvasCtx.lineWidth = 2;
    canvasCtx.fillStyle = '#ffffff';

    HAND_CONNECTIONS.forEach(conn => {
        const p1 = landmarks[conn[0]];
        const p2 = landmarks[conn[1]];
        canvasCtx.beginPath();
        canvasCtx.moveTo(p1.x * canvasElement.width, p1.y * canvasElement.height);
        canvasCtx.lineTo(p2.x * canvasElement.width, p2.y * canvasElement.height);
        canvasCtx.stroke();
    });

    landmarks.forEach(lm => {
         canvasCtx.beginPath();
        canvasCtx.arc(lm.x * canvasElement.width, lm.y * canvasElement.height, 3, 0, 2 * Math.PI);
         canvasCtx.fill();
    });
}

function trackHandMovement() {
    if (!handLandmarker || webcamElement.readyState !== 4 || isEnteringPortal) {
        isHandVisible = false;
        return;
    }

    let startTimeMs = performance.now();
    if (lastVideoTime !== webcamElement.currentTime) {
    lastVideoTime = webcamElement.currentTime;
        const detections = handLandmarker.detectForVideo(webcamElement, startTimeMs);

    canvasElement.width = webcamElement.videoWidth;
    canvasElement.height = webcamElement.videoHeight;
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

        if (detections.landmarks && detections.landmarks.length > 0) {
            isHandVisible = true;
            const landmarks = detections.landmarks[0];
             drawHand(landmarks);

            const wrist = landmarks[0];

             handX_3D = (wrist.x - 0.5) * -160;
             handY_3D = -(wrist.y - 0.5) * 120;

            const tips = [landmarks[8], landmarks[12], landmarks[16], landmarks[20]];
              let totalDistance = 0;
             for (let tip of tips) {
                totalDistance += Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
            }
            const avgDistance = totalDistance / 4;

              if (avgDistance < 0.24) {
                isScattered = false;
            }
            else if (avgDistance > 0.36) {
                isScattered = true;

                if (!gestureCooldown) {
                    gestureCooldown = true;
                    currentWordIndex++;
                    if (currentWordIndex >= words.length) currentWordIndex = 0;

                    particleMaterial.color.setHex(neonColors[currentWordIndex]);

                    generateTextTargets(words[currentWordIndex]);

                    const positions = particleGeometry.attributes.position.array;
                    for (let i = 0; i < PARTICLE_COUNT * 3; i++) {
                        positions[i] += (Math.random() - 0.5) * 40;
                    }

                    setTimeout(() => { gestureCooldown = false; }, 1000);
                }

                targetRotationY = (0.5 - wrist.x) * 1.5;
                targetRotationX = (wrist.y - 0.5) * 1.5;
            }

            const thumbTip = landmarks[4];
            const indexTip = landmarks[8];
            const middleTip = landmarks[12];

            const snapDistance = Math.hypot(thumbTip.x - middleTip.x, thumbTip.y - middleTip.y);
            const indexDist = Math.hypot(indexTip.x - wrist.x, indexTip.y - wrist.y);

            if (snapDistance < 0.045 && indexDist > 0.30 && !gestureCooldown) {
                startPortalTransition();
            }
        } else {
            isHandVisible = false;
        }
    }
}

function startPortalTransition() {
    gestureCooldown = true;
    isEnteringPortal = true;

    particleMaterial.color.setHex(0xffffff);

    setTimeout(() => {
        window.open('https://abdelwahedabdellaoui.pages.dev/', '_blank');
        
        isEnteringPortal = false;
        isScattered = true;
        gestureCooldown = false;
    }, 800);
}

function generateTextTargets(text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1100; canvas.height = 300;
    ctx.fillStyle = '#ffffff';
    ctx.font = text.length > 10 ? 'bold 90px sans-serif' : 'bold 130px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const validPixels = [];

    for (let y = 0; y < canvas.height; y += 2) {
        for (let x = 0; x < canvas.width; x += 2) {
            const index = (y * canvas.width + x) * 4;
            if (imgData.data[index] > 200) {
                validPixels.push({ x: (x - canvas.width / 2) * 0.13, y: (canvas.height / 2 - y) * 0.13 });
            }
        }
    }

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3;
        if (validPixels.length > 0) {
            const pixel = validPixels[i % validPixels.length];
            targetPositions[i3] = pixel.x + (Math.random() - 0.5) * 0.2;
            targetPositions[i3 + 1] = pixel.y + (Math.random() - 0.5) * 0.2;
            targetPositions[i3 + 2] = (Math.random() - 0.5) * 2;
        } else {
            targetPositions[i3] = 0; targetPositions[i3 + 1] = 0; targetPositions[i3 + 2] = 0;
        }
    }
}

function createCircleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.beginPath(); ctx.arc(16, 16, 14, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.fill();

    ctx.shadowBlur = 10;
    ctx.shadowColor = "white";
    ctx.fill();

    return new THREE.CanvasTexture(canvas);
}

function createParticleSystem() {
    particleGeometry = new THREE.BufferGeometry();
    const initialPositions = new Float32Array(PARTICLE_COUNT * 3);

    for (let i = 0; i < PARTICLE_COUNT * 3; i += 3) {
        const radius = 180 * Math.cbrt(Math.random());
        const theta = Math.random() * 2 * Math.PI;
        const phi = Math.acos(2 * Math.random() - 1);

        const x = radius * Math.sin(phi) * Math.cos(theta);
        const y = radius * Math.sin(phi) * Math.sin(theta);
        const z = radius * Math.cos(phi);

        initialPositions[i] = x; initialPositions[i+1] = y; initialPositions[i+2] = z;
        scatterPositions[i] = x; scatterPositions[i+1] = y; scatterPositions[i+2] = z;
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(initialPositions, 3));

    particleMaterial = new THREE.PointsMaterial({
        color: neonColors[0],
        size: 0.45,
        map: createCircleTexture(),
        transparent: true,
        opacity: 0.9,
        alphaTest: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    particleSystem = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particleSystem);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    trackHandMovement();

    if (particleMaterial) {
        particleMaterial.size = 0.45 + Math.sin(Date.now() * 0.005) * 0.12;
    }

    if (particleGeometry) {
        const positions = particleGeometry.attributes.position.array;
        const lerpFactor = isScattered ? 0.1 : 0.07;

        for (let i = 0; i < PARTICLE_COUNT * 3; i += 3) {

            if (isEnteringPortal) {
                positions[i+2] += 4.5;
                positions[i] += (Math.random() - 0.5) * 1.5;
                positions[i+1] += (Math.random() - 0.5) * 1.5;
            }
            else {
                const targetX = isScattered ? scatterPositions[i] : targetPositions[i];
                const targetY = isScattered ? scatterPositions[i+1] : targetPositions[i+1];
                const targetZ = isScattered ? scatterPositions[i+2] : targetPositions[i+2];

                let forceX = 0, forceY = 0;
                if (isHandVisible && !isScattered) {
                    const dx = positions[i] - handX_3D;
                    const dy = positions[i+1] - handY_3D;
                    const distanceToHand = Math.sqrt(dx*dx + dy*dy);

                    if (distanceToHand < 20) {
                        const repelStrength = (20 - distanceToHand) / 20;
                        forceX = (dx / distanceToHand) * repelStrength * 8;
                        forceY = (dy / distanceToHand) * repelStrength * 8;

                        positions[i+2] += (Math.random() - 0.5) * repelStrength * 10;
                    }
                }

                positions[i] += (targetX - positions[i]) * lerpFactor + forceX;
                positions[i+1] += (targetY - positions[i+1]) * lerpFactor + forceY;
                positions[i+2] += (targetZ - positions[i+2]) * lerpFactor;
            }
        }

        particleGeometry.attributes.position.needsUpdate = true;

        if (!isEnteringPortal) {
            if (isScattered) {
                particleSystem.rotation.y += (targetRotationY - particleSystem.rotation.y) * 0.05;
                particleSystem.rotation.x += (targetRotationX - particleSystem.rotation.x) * 0.05;
                particleSystem.rotation.z += 0.002;
            } else {
                particleSystem.rotation.y += (Math.sin(Date.now() * 0.0003) * 0.08 - particleSystem.rotation.y) * 0.05;
                particleSystem.rotation.x += (0 - particleSystem.rotation.x) * 0.05;
                particleSystem.rotation.z += (0 - particleSystem.rotation.z) * 0.05;
            }
        }
    }
    renderer.render(scene, camera);
}

async function setupWebcam() {
    if (!webcamElement) return;
    try { const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } }); webcamElement.srcObject = stream; }
    catch (err) { }
}

async function initMediaPipe() {
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm");
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", delegate: "GPU" },
        runningMode: "VIDEO", numHands: 1
    });
}

async function start() {
    initThree();
    await setupWebcam();
    createParticleSystem();
    generateTextTargets(words[currentWordIndex]);
    await initMediaPipe();
    animate();
}

start();