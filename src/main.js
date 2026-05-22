import * as THREE from 'three';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

let scene, camera, renderer;
let particleGeometry, particleSystem, particleMaterial;
let gridHelper;

const webcamElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');

const PARTICLE_COUNT = 15000;
const targetPositions = new Float32Array(PARTICLE_COUNT * 3);
const scatterPositions = new Float32Array(PARTICLE_COUNT * 3);

const words = ['VISION', 'LOGIC', 'EXECUTION', "LET'S BUILD", 'ABDELWAHED'];
const neonColors = [0x00f3ff, 0xff00ff, 0x00ff88, 0xffd700, 0xff3366];
const neonColorsHex = ['#00f3ff', '#ff00ff', '#00ff88', '#ffd700', '#ff3366'];
const neonColorsRGB = ['0, 243, 255', '255, 0, 255', '0, 255, 136', '255, 215, 0', '255, 51, 102'];
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

// Portal warp variables
let portalWarpCharge = 0;
const WARP_SPEED = 1.2; // rate at which warp charges
const DECAY_SPEED = 2.5; // rate at which warp discharges when let go

// Frame counters for FPS
let lastFpsTime = 0;
let frameCount = 0;

const HAND_CONNECTIONS = [
    [0,1], [1,2], [2,3], [3,4], [0,5], [5,6], [6,7], [7,8],
    [5,9], [9,10], [10,11], [11,12], [9,13], [13,14], [14,15],
    [15,16], [13,17], [0,17], [17,18], [18,19], [19,20]
];

function initThree() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020205, 0.005);
    
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 60;
    
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x020205, 1);
    
    document.body.appendChild(renderer.domElement);
    
    // Create futuristic grid floor
    updateGridColor(neonColorsHex[0]);
    
    window.addEventListener('resize', onWindowResize);
}

function updateGridColor(colorHex) {
    if (gridHelper) scene.remove(gridHelper);
    
    // Create custom grid with thin glowing lines
    gridHelper = new THREE.GridHelper(300, 50, new THREE.Color(colorHex), new THREE.Color(0x111622));
    gridHelper.position.y = -35;
    gridHelper.rotation.x = 0.05; // slight tilt for deep 3D effect
    gridHelper.material.opacity = 0.45;
    gridHelper.material.transparent = true;
    
    scene.add(gridHelper);
}

function updateHUDTheme(hex, rgb) {
    // Update active colors in CSS root
    document.documentElement.style.setProperty('--active-neon', hex);
    document.documentElement.style.setProperty('--active-neon-rgb', rgb);
    
    // Trigger dynamic class update for text color of the active word display
    const activeWordEl = document.getElementById('hud-active-word');
    if (activeWordEl) {
        activeWordEl.innerText = words[currentWordIndex];
        // Reset classes
        activeWordEl.className = 'tel-val';
        // Add specific color class
        if (currentWordIndex === 0) activeWordEl.classList.add('text-neon-cyan');
        else if (currentWordIndex === 1) activeWordEl.classList.add('text-neon-magenta');
        else if (currentWordIndex === 2) activeWordEl.classList.add('text-neon-green');
        else if (currentWordIndex === 3) activeWordEl.classList.add('text-neon-gold');
        else if (currentWordIndex === 4) activeWordEl.classList.add('text-neon-crimson');
    }
    
    // Flash HUD UI container as reaction
    const panels = document.querySelectorAll('.hud-panel, #video-container');
    panels.forEach(p => {
        p.classList.remove('flash-hud');
        void p.offsetWidth; // trigger reflow
        p.classList.add('flash-hud');
    });
}

function drawHand(landmarks) {
    canvasCtx.strokeStyle = '#' + neonColors[currentWordIndex].toString(16).padStart(6, '0');
    canvasCtx.lineWidth = 3;
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
         canvasCtx.arc(lm.x * canvasElement.width, lm.y * canvasElement.height, 4, 0, 2 * Math.PI);
         canvasCtx.fill();
    });
}

function trackHandMovement() {
    // Handle FPS counter
    frameCount++;
    const nowTime = performance.now();
    if (nowTime - lastFpsTime >= 1000) {
        const fps = Math.round((frameCount * 1000) / (nowTime - lastFpsTime));
        const fpsEl = document.getElementById('fps-counter');
        if (fpsEl) fpsEl.innerText = `FPS: ${fps}`;
        frameCount = 0;
        lastFpsTime = nowTime;
    }

    if (!handLandmarker || webcamElement.readyState !== 4 || isEnteringPortal) {
        isHandVisible = false;
        updateWarpCharge(false); // discharge if not tracking
        return;
    }

    let startTimeMs = performance.now();
    if (lastVideoTime !== webcamElement.currentTime) {
        lastVideoTime = webcamElement.currentTime;
        const detections = handLandmarker.detectForVideo(webcamElement, startTimeMs);

        canvasElement.width = webcamElement.videoWidth;
        canvasElement.height = webcamElement.videoHeight;
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

        const statusEl = document.getElementById('system-status');
        const hintEl = document.getElementById('hint-text');
        const activeAssembleCard = document.getElementById('gesture-assemble');
        const activeScatterCard = document.getElementById('gesture-scatter');
        const activeSnapCard = document.getElementById('gesture-snap');
        const radarBlip = document.getElementById('radar-blip');

        if (detections.landmarks && detections.landmarks.length > 0) {
            isHandVisible = true;
            
            if (statusEl) {
                statusEl.innerText = 'SYS_ACTIVE';
                statusEl.className = 'hud-status-val status-detected';
            }
            if (hintEl) {
                hintEl.innerText = 'SYSTEM TRACKING ACTIVE';
            }
            
            const landmarks = detections.landmarks[0];
            drawHand(landmarks);

            const wrist = landmarks[0];
            
            // Map wrist to 3D positions
            handX_3D = (wrist.x - 0.5) * -160;
            handY_3D = -(wrist.y - 0.5) * 120;
            
            // Map wrist to Radar widget blip
            if (radarBlip) {
                radarBlip.style.left = `${(1 - wrist.x) * 100}%`; // reverse since webcam is flipped
                radarBlip.style.top = `${wrist.y * 100}%`;
                radarBlip.style.opacity = '1';
            }

            const tips = [landmarks[8], landmarks[12], landmarks[16], landmarks[20]];
            let totalDistance = 0;
            for (let tip of tips) {
                totalDistance += Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
            }
            const avgDistance = totalDistance / 4;

            // Detect Pinch (Thumb & Middle finger)
            const thumbTip = landmarks[4];
            const indexTip = landmarks[8];
            const middleTip = landmarks[12];

            const snapDistance = Math.hypot(thumbTip.x - middleTip.x, thumbTip.y - middleTip.y);
            const indexDist = Math.hypot(indexTip.x - wrist.x, indexTip.y - wrist.y);

            let gestureDetected = 'none';

            // Snap/Pinch trigger
            if (snapDistance < 0.05 && indexDist > 0.28) {
                gestureDetected = 'snap';
                updateWarpCharge(true);
                
                if (activeSnapCard) activeSnapCard.classList.add('active');
                if (activeAssembleCard) activeAssembleCard.classList.remove('active');
                if (activeScatterCard) activeScatterCard.classList.remove('active');
            } 
            // Fist (Assemble text)
            else if (avgDistance < 0.24) {
                gestureDetected = 'assemble';
                isScattered = false;
                updateWarpCharge(false);
                
                if (activeAssembleCard) activeAssembleCard.classList.add('active');
                if (activeScatterCard) activeScatterCard.classList.remove('active');
                if (activeSnapCard) activeSnapCard.classList.remove('active');
            }
            // Open Hand (Scatter text & change word)
            else if (avgDistance > 0.35) {
                gestureDetected = 'scatter';
                isScattered = true;
                updateWarpCharge(false);
                
                if (activeScatterCard) activeScatterCard.classList.add('active');
                if (activeAssembleCard) activeAssembleCard.classList.remove('active');
                if (activeSnapCard) activeSnapCard.classList.remove('active');

                // Advance words on open hand swipe gesture
                if (!gestureCooldown) {
                    gestureCooldown = true;
                    
                    const cdEl = document.getElementById('hud-cooldown');
                    if (cdEl) {
                        cdEl.innerText = 'ON';
                        cdEl.className = 'tel-val text-neon-magenta';
                    }
                    
                    currentWordIndex++;
                    if (currentWordIndex >= words.length) currentWordIndex = 0;

                    // Update Materials & HUD themes
                    particleMaterial.color.setHex(neonColors[currentWordIndex]);
                    updateHUDTheme(neonColorsHex[currentWordIndex], neonColorsRGB[currentWordIndex]);
                    updateGridColor(neonColorsHex[currentWordIndex]);

                    generateTextTargets(words[currentWordIndex]);

                    // Add an explosion of particles
                    const positions = particleGeometry.attributes.position.array;
                    for (let i = 0; i < PARTICLE_COUNT * 3; i++) {
                        positions[i] += (Math.random() - 0.5) * 45;
                    }

                    setTimeout(() => { 
                        gestureCooldown = false; 
                        const cdElVal = document.getElementById('hud-cooldown');
                        if (cdElVal) {
                            cdElVal.innerText = 'OFF';
                            cdElVal.className = 'tel-val text-inactive';
                        }
                    }, 1400);
                }

                targetRotationY = (0.5 - wrist.x) * 1.5;
                targetRotationX = (wrist.y - 0.5) * 1.5;
            } else {
                // In between gesture state
                updateWarpCharge(false);
                if (activeAssembleCard) activeAssembleCard.classList.remove('active');
                if (activeScatterCard) activeScatterCard.classList.remove('active');
                if (activeSnapCard) activeSnapCard.classList.remove('active');
            }

        } else {
            // Hand not visible
            isHandVisible = false;
            updateWarpCharge(false);
            
            if (statusEl) {
                statusEl.innerText = 'SCANNING...';
                statusEl.className = 'hud-status-val status-scanning';
            }
            if (hintEl) {
                hintEl.innerText = 'RAISE YOUR HAND TO BEGIN INTERACTION';
            }
            
            if (activeAssembleCard) activeAssembleCard.classList.remove('active');
            if (activeScatterCard) activeScatterCard.classList.remove('active');
            if (activeSnapCard) activeSnapCard.classList.remove('active');
            if (radarBlip) radarBlip.style.opacity = '0';
        }
    }
}

function updateWarpCharge(isCharging) {
    const overlay = document.getElementById('portal-overlay');
    const progressBar = document.getElementById('portal-progress');
    const hudGain = document.getElementById('hud-portal-gain');
    
    if (isCharging) {
        portalWarpCharge = Math.min(100, portalWarpCharge + WARP_SPEED);
        
        if (overlay) overlay.classList.add('active');
        if (hudGain) {
            hudGain.innerText = `${portalWarpCharge.toFixed(1)}%`;
            hudGain.className = 'tel-val text-active';
        }
        
        if (portalWarpCharge >= 100 && !isEnteringPortal) {
            startPortalTransition();
        }
    } else {
        // Decay charge slowly if not charging, unless portal warp has been committed
        if (!isEnteringPortal) {
            portalWarpCharge = Math.max(0, portalWarpCharge - DECAY_SPEED);
            
            if (portalWarpCharge === 0) {
                if (overlay) overlay.classList.remove('active');
                if (hudGain) {
                    hudGain.innerText = '0.0%';
                    hudGain.className = 'tel-val text-inactive';
                }
            } else {
                if (hudGain) {
                    hudGain.innerText = `${portalWarpCharge.toFixed(1)}%`;
                }
            }
        }
    }
    
    if (progressBar) progressBar.style.width = `${portalWarpCharge}%`;
}

function startPortalTransition() {
    isEnteringPortal = true;
    gestureCooldown = true;

    // Turn particles white and make them zoom rapidly
    particleMaterial.color.setHex(0xffffff);
    
    const portalTitle = document.querySelector('.portal-title');
    if (portalTitle) portalTitle.innerText = 'WARP GATES COMMITTED';

    setTimeout(() => {
        window.open('https://abdelwahedabdellaoui.pages.dev/', '_blank');
        
        // Reset state after jump trigger
        setTimeout(() => {
            isEnteringPortal = false;
            isScattered = true;
            gestureCooldown = false;
            portalWarpCharge = 0;
            const overlay = document.getElementById('portal-overlay');
            if (overlay) overlay.classList.remove('active');
            const portalTitleReset = document.querySelector('.portal-title');
            if (portalTitleReset) portalTitleReset.innerText = 'WARP GATES ENGAGED';
            particleMaterial.color.setHex(neonColors[currentWordIndex]);
        }, 1000);
    }, 1500);
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
        opacity: 0.95,
        alphaTest: 0.05,
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
        const lerpFactor = isScattered ? 0.08 : 0.06;

        for (let i = 0; i < PARTICLE_COUNT * 3; i += 3) {

            if (isEnteringPortal) {
                positions[i+2] += 6.5; // fly forward into screen
                positions[i] += (Math.random() - 0.5) * 2.5;
                positions[i+1] += (Math.random() - 0.5) * 2.5;
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

                    if (distanceToHand < 22) {
                        const repelStrength = (22 - distanceToHand) / 22;
                        forceX = (dx / distanceToHand) * repelStrength * 10;
                        forceY = (dy / distanceToHand) * repelStrength * 10;

                        positions[i+2] += (Math.random() - 0.5) * repelStrength * 12;
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
                particleSystem.rotation.y += (targetRotationY - particleSystem.rotation.y) * 0.04;
                particleSystem.rotation.x += (targetRotationX - particleSystem.rotation.x) * 0.04;
                particleSystem.rotation.z += 0.0015;
                
                // Slowly rotate grid as well
                if (gridHelper) {
                    gridHelper.rotation.y += 0.001;
                }
            } else {
                particleSystem.rotation.y += (Math.sin(Date.now() * 0.0003) * 0.08 - particleSystem.rotation.y) * 0.05;
                particleSystem.rotation.x += (0 - particleSystem.rotation.x) * 0.05;
                particleSystem.rotation.z += (0 - particleSystem.rotation.z) * 0.05;
                
                if (gridHelper) {
                    gridHelper.rotation.y += (0 - gridHelper.rotation.y) * 0.05;
                }
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
        
        const feedStatus = document.getElementById('feed-status');
        if (feedStatus) {
            feedStatus.innerText = 'ONLINE';
            feedStatus.className = 'feed-status active';
        }
    }
    catch (err) {
        console.error("Webcam access denied or unavailable: ", err);
    }
}

async function initMediaPipe() {
    try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm");
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", delegate: "GPU" },
            runningMode: "VIDEO", numHands: 1
        });
    } catch (e) {
        console.error("MediaPipe failed to load: ", e);
    }
}

// Scaffold system flow: Show 3D scene immediately, deferred camera activation on user click
function start() {
    initThree();
    createParticleSystem();
    generateTextTargets(words[currentWordIndex]);
    
    // Setup interactive portal button manually to bypass popup blocker
    const portalBtn = document.getElementById('portal-btn');
    if (portalBtn) {
        portalBtn.addEventListener('click', () => {
            window.open('https://abdelwahedabdellaoui.pages.dev/', '_blank');
        });
    }

    const cancelPortalBtn = document.getElementById('cancel-portal-btn');
    if (cancelPortalBtn) {
        cancelPortalBtn.addEventListener('click', () => {
            isEnteringPortal = false;
            portalWarpCharge = 0;
            const overlay = document.getElementById('portal-overlay');
            if (overlay) overlay.classList.remove('active');
            particleMaterial.color.setHex(neonColors[currentWordIndex]);
        });
    }

    // Start prompt initialization
    const startBtn = document.getElementById('start-btn');
    const welcomePrompt = document.getElementById('welcome-prompt');
    
    if (startBtn && welcomePrompt) {
        startBtn.addEventListener('click', async () => {
            startBtn.innerText = "CONNECTING CAMERA...";
            startBtn.style.borderColor = "var(--neon-gold)";
            startBtn.style.color = "var(--neon-gold)";
            
            // Connect camera and AI tracking
            await setupWebcam();
            await initMediaPipe();
            
            // Fade out overlay beautifully
            welcomePrompt.style.opacity = '0';
            setTimeout(() => {
                welcomePrompt.style.display = 'none';
            }, 500);
        });
    }

    // Begin render loop
    animate();
}

start();
