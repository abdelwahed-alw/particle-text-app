import * as THREE from 'three';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

let scene, camera, renderer;
let particleGeometry, particleSystem;

const webcamElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');

const PARTICLE_COUNT = 15000;
const targetPositions = new Float32Array(PARTICLE_COUNT * 3);
// مصفوفة جديدة لحفظ مواقع عشوائية لكي تتشتت إليها الجزيئات
const scatterPositions = new Float32Array(PARTICLE_COUNT * 3); 

const words = ['VISION', 'LOGIC', 'EXECUTION', "LET'S BUILD", 'ABDELWAHED'];
let currentWordIndex = 0;

let handLandmarker;
let lastVideoTime = -1;
let gestureCooldown = false;

let isEnteringPortal = false; // 🌟 المتغير الجديد الخاص بالخاتمة

// متغيرات الحالة الجديدة للتحكم في السيناريو
let isScattered = true; // هل الجزيئات مشتتة أم متجمعة؟
let isSnapping = false;  // لتتبع وضع الاستعداد لفرقعة الأصابع

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
    canvasCtx.strokeStyle = '#00f3ff'; 
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

// 🌟 الخوارزمية الجديدة: التشتت + التجميع + فرقعة الأصابع
function trackHandMovement() {
    if (!handLandmarker || webcamElement.readyState !== 4) return;

    let startTimeMs = performance.now();
    if (lastVideoTime !== webcamElement.currentTime) {
        lastVideoTime = webcamElement.currentTime;
        const detections = handLandmarker.detectForVideo(webcamElement, startTimeMs);

        canvasElement.width = webcamElement.videoWidth;
        canvasElement.height = webcamElement.videoHeight;
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

        if (detections.landmarks && detections.landmarks.length > 0) {
            const landmarks = detections.landmarks[0];
            drawHand(landmarks);

            const wrist = landmarks[0];
            const tips = [landmarks[8], landmarks[12], landmarks[16], landmarks[20]];
            let totalDistance = 0;
            for (let tip of tips) {
                totalDistance += Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
            }
            const avgDistance = totalDistance / 4;

            // 1. التحكم في التشتت والتجميع (Spread vs Close)
            if (avgDistance > 0.40) {
                isScattered = true;  // اليد مفتوحة = تشتيت
            } else if (avgDistance < 0.25) {
                isScattered = false; // اليد مغلقة = تجميع ببطء
            }

            // 2. التحكم في فرقعة الأصابع (Thumb & Middle Finger Snap)
            const thumbTip = landmarks[4];
            const middleTip = landmarks[12];
            // قياس المسافة بين الإبهام والوسطى
            const snapDistance = Math.hypot(thumbTip.x - middleTip.x, thumbTip.y - middleTip.y);

            // إذا تلامس الإبهام والوسطى (الاستعداد للفرقعة)
            if (snapDistance < 0.05) {
                isSnapping = true;
            } 
            // إذا افترقا فجأة (تنفيذ الفرقعة)
            else if (snapDistance > 0.10 && isSnapping && !gestureCooldown) {
                triggerNextState(); // الانتقال للكلمة التالية
                isSnapping = false;
            }
        }
    }
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

// 🌟 دالة لإنشاء شكل الكرة (دائرة مضيئة) للجزيئات بدلاً من المربع الافتراضي
function createCircleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(16, 16, 14, 0, Math.PI * 2); // رسم دائرة مثالية
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    return new THREE.CanvasTexture(canvas);
}

function createParticleSystem() {
    particleGeometry = new THREE.BufferGeometry();
    const initialPositions = new Float32Array(PARTICLE_COUNT * 3);
    
    // 🌟 السحر هنا: توزيع الجزيئات على شكل كرة ثلاثية الأبعاد (مجرة)
    for (let i = 0; i < PARTICLE_COUNT * 3; i += 3) {
        
        // إحداثيات كروية (Spherical Coordinates)
        const radius = 180 * Math.cbrt(Math.random()); // نصف قطر الكرة
        const theta = Math.random() * 2 * Math.PI;
        const phi = Math.acos(2 * Math.random() - 1);
        
        // تحويلها إلى X, Y, Z لمواقع التشتت
        const x = radius * Math.sin(phi) * Math.cos(theta);
        const y = radius * Math.sin(phi) * Math.sin(theta);
        const z = radius * Math.cos(phi);

        // المواضع الأولية لحظة تحميل الصفحة
        initialPositions[i] = x;
        initialPositions[i+1] = y;
        initialPositions[i+2] = z;

        // مواقع التشتت الدائمة (التي تعود إليها الكريات عند فتح اليد)
        scatterPositions[i] = x;
        scatterPositions[i+1] = y;
        scatterPositions[i+2] = z;
    }
    
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(initialPositions, 3));
    
    const particleMaterial = new THREE.PointsMaterial({
        color: 0x00f3ff, 
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
function triggerNextState() {
    gestureCooldown = true;

    // إذا لم نصل للكلمة الأخيرة بعد (ننتقل طبيعياً)
    if (currentWordIndex < words.length - 1) {
        currentWordIndex++;
        
        // انفجار التشتت بين الكلمات
        const positions = particleGeometry.attributes.position.array;
        for (let i = 0; i < PARTICLE_COUNT * 3; i++) {
            positions[i] += (Math.random() - 0.5) * 30; 
        }
        
        generateTextTargets(words[currentWordIndex]);
        setTimeout(() => { gestureCooldown = false; }, 1000);
    } 
    // 🌟 إذا وصلنا للكلمة الأخيرة واسمك معروض (الخاتمة!)
    else {
        isEnteringPortal = true; // تفعيل تأثير القفز الفضائي
        console.log("تم تفعيل بوابة القفز الفضائي!");
        
        // ننتظر ثانية ونصف حتى يستمتع الزائر بمشهد اندفاع الجزيئات ثم نفتح الموقع
        setTimeout(() => {
            window.location.href = 'https://github.com/abdelwahed-abd';
            
            // إعادة ضبط المشهد في الخلفية أثناء التحميل
           
        }, 1500);
    }
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
        const lerpFactor = isScattered ? 0.014 : 0.08;

        for (let i = 0; i < PARTICLE_COUNT * 3; i++) {
            
            // 🌟 الخاتمة: الاندفاع نحو الشاشة (Warp Speed)
            if (isEnteringPortal) {
                // i % 3 === 2 يعني أننا نعدل محور Z (العمق)
                if (i % 3 === 2) {
                    positions[i] += 4.5; // سرعة الاندفاع نحو الكاميرا
                } else {
                    // اهتزاز خفيف جداً في محوري X و Y لتبدو كالنفق
                    positions[i] += (Math.random() - 0.5) * 1.5;
                }
            } 
            // الحركة الطبيعية للتشتت أو التجميع
            else {
                const targetPos = isScattered ? scatterPositions[i] : targetPositions[i];
                positions[i] += (targetPos - positions[i]) * lerpFactor;
            }
        }
        
        particleGeometry.attributes.position.needsUpdate = true;
        
        // إيقاف الدوران أثناء الاندفاع ليكون التركيز على اختراق الشاشة
        if (!isEnteringPortal) {
            particleSystem.rotation.y = Math.sin(Date.now() * 0.0003) * 0.08;
            
            if (isScattered) {
                particleSystem.rotation.z += 0.002; 
            } else {
                particleSystem.rotation.z += (0 - particleSystem.rotation.z) * 0.05;
            }
        }
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