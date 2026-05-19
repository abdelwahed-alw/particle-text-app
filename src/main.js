import * as THREE from 'three';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

let scene, camera, renderer;
let particleGeometry, particleSystem;
const webcamElement = document.getElementById('webcam');

// إعدادات الجزيئات
const PARTICLE_COUNT = 15000;
const targetPositions = new Float32Array(PARTICLE_COUNT * 3);

// إدارة الحالات والكلمات
const words = ['VISION', 'LOGIC', 'EXECUTION', "LET'S BUILD", 'ABDELWAHED'];
let currentWordIndex = 0;

let handLandmarker;
let lastVideoTime = -1;
let gestureCooldown = false;

// 1. قوالب الإحداثيات التي قمت باصطيادها بنفسك 🎯
const GESTURE_CLOSED_TEMPLATE = [
  {"point": 0, "distanceToWrist": 0}, {"point": 1, "distanceToWrist": 0.0792}, {"point": 2, "distanceToWrist": 0.1955},
  {"point": 3, "distanceToWrist": 0.2751}, {"point": 4, "distanceToWrist": 0.2957}, {"point": 5, "distanceToWrist": 0.3423},
  {"point": 6, "distanceToWrist": 0.3601}, {"point": 7, "distanceToWrist": 0.2647}, {"point": 8, "distanceToWrist": 0.2477},
  {"point": 9, "distanceToWrist": 0.3346}, {"point": 10, "distanceToWrist": 0.3352}, {"point": 11, "distanceToWrist": 0.2282},
  {"point": 12, "distanceToWrist": 0.2263}, {"point": 13, "distanceToWrist": 0.3038}, {"point": 14, "distanceToWrist": 0.256},
  {"point": 15, "distanceToWrist": 0.1675}, {"point": 16, "distanceToWrist": 0.1778}, {"point": 17, "distanceToWrist": 0.2686},
  {"point": 18, "distanceToWrist": 0.1924}, {"point": 19, "distanceToWrist": 0.1352}, {"point": 20, "distanceToWrist": 0.1517}
];

const GESTURE_OPEN_TEMPLATE = [
  {"point": 0, "distanceToWrist": 0}, {"point": 1, "distanceToWrist": 0.1009}, {"point": 2, "distanceToWrist": 0.1967},
  {"point": 3, "distanceToWrist": 0.286}, {"point": 4, "distanceToWrist": 0.3719}, {"point": 5, "distanceToWrist": 0.3215},
  {"point": 6, "distanceToWrist": 0.4686}, {"point": 7, "distanceToWrist": 0.5663}, {"point": 8, "distanceToWrist": 0.6552},
  {"point": 9, "distanceToWrist": 0.3218}, {"point": 10, "distanceToWrist": 0.4835}, {"point": 11, "distanceToWrist": 0.5933},
  {"point": 12, "distanceToWrist": 0.693}, {"point": 13, "distanceToWrist": 0.2912}, {"point": 14, "distanceToWrist": 0.4322},
  {"point": 15, "distanceToWrist": 0.5374}, {"point": 16, "distanceToWrist": 0.6365}, {"point": 17, "distanceToWrist": 0.2422},
  {"point": 18, "distanceToWrist": 0.3455}, {"point": 19, "distanceToWrist": 0.4185}, {"point": 20, "distanceToWrist": 0.4919}
];

let isHandClosedBefore = false; 

// دالة بناء مشهد الـ 3D الأساسي
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

// دالة المقارنة الرياضية وحساب الفارق بين اليد الحية والقالب
function calculateGestureError(liveLandmarks, template) {
    const wrist = liveLandmarks[0];
    let totalError = 0;

    for (let i = 1; i < 21; i++) {
        const lm = liveLandmarks[i];
        const liveDist = Math.hypot(lm.x - wrist.x, lm.y - wrist.y);
        const templateDist = template[i].distanceToWrist;
        totalError += Math.abs(liveDist - templateDist);
    }
    
    return totalError / 20;
}

// دالة الفحص الذكي لليد
function trackHandMovement() {
    if (!handLandmarker || webcamElement.readyState !== 4) return;

    let startTimeMs = performance.now();
    if (lastVideoTime !== webcamElement.currentTime) {
        lastVideoTime = webcamElement.currentTime;
        const detections = handLandmarker.detectForVideo(webcamElement, startTimeMs);

        if (detections.landmarks && detections.landmarks.length > 0) {
            const liveLandmarks = detections.landmarks[0];

            const closedError = calculateGestureError(liveLandmarks, GESTURE_CLOSED_TEMPLATE);
            const openError = calculateGestureError(liveLandmarks, GESTURE_OPEN_TEMPLATE);

            const MATCH_THRESHOLD = 0.09; 

            if (closedError < MATCH_THRESHOLD) {
                isHandClosedBefore = true;
            } 
            else if (openError < MATCH_THRESHOLD && isHandClosedBefore && !gestureCooldown) {
                triggerNextState();
                isHandClosedBefore = false; 
            }
        }
    }
}

// دالة تحويل النص إلى أهداف بكسلية دقيقة
function generateTextTargets(text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1100;
    canvas.height = 300;
    ctx.fillStyle = '#ffffff';
    ctx.font = text.length > 10 ? 'bold 90px sans-serif' : 'bold 130px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const validPixels = [];

    for (let y = 0; y < canvas.height; y += 2) {
        for (let x = 0; x < canvas.width; x += 2) {
            const index = (y * canvas.width + x) * 4;
            if (imgData.data[index] > 200) {
                validPixels.push({
                    x: (x - canvas.width / 2) * 0.13,
                    y: (canvas.height / 2 - y) * 0.13
                });
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
            targetPositions[i3] = 0; 
            targetPositions[i3 + 1] = 0; 
            targetPositions[i3 + 2] = 0;
        }
    }
}

function createParticleSystem() {
    particleGeometry = new THREE.BufferGeometry();
    const initialPositions = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT * 3; i++) {
        initialPositions[i] = (Math.random() - 0.5) * 250;
    }
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(initialPositions, 3));
    const particleMaterial = new THREE.PointsMaterial({
        color: 0x00f3ff, size: 0.28, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending
    });
    particleSystem = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particleSystem);
}

function triggerNextState() {
    gestureCooldown = true;
    currentWordIndex++;

    if (currentWordIndex < words.length) {
        generateTextTargets(words[currentWordIndex]);
    } else {
        window.open('https://yourportfolio.com', '_blank'); 
        currentWordIndex = 0;
        generateTextTargets(words[currentWordIndex]);
    }

    setTimeout(() => { gestureCooldown = false; }, 1500);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    trackHandMovement();

    if (particleGeometry) {
        const positions = particleGeometry.attributes.position.array;
        for (let i = 0; i < PARTICLE_COUNT * 3; i++) {
            const currentPos = positions[i];
            const targetPos = targetPositions[i];
            positions[i] += (targetPos - currentPos) * 0.07;
        }
        particleGeometry.attributes.position.needsUpdate = true;
        particleSystem.rotation.y = Math.sin(Date.now() * 0.0003) * 0.08;
    }
    renderer.render(scene, camera);
}

async function setupWebcam() {
    if (!webcamElement) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        webcamElement.srcObject = stream;
    } catch (err) { console.error(err); }
}

async function initMediaPipe() {
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm");
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU"
        },
        runningMode: "VIDEO", numHands: 1
    });
    console.log("المحرك جاهز ومتطابق مع قوالبك الشخصية!");
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