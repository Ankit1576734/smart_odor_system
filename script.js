// --- Firebase SDK Imports ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getDatabase, ref, onValue, update } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

// --- Firebase Project Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyBQT_dyBaQzl4kkHc11SbOH9DVONoYdLUE",
    authDomain: "esp32-1a712.firebaseapp.com",
    databaseURL: "https://esp32-1a712-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "esp32-1a712",
    storageBucket: "esp32-1a712.appspot.com",
    messagingSenderId: "1057788443915",
    appId: "1:1057788443915:web:1ecc7202b2fc8438bb760e"
};

// --- Firebase Initialization ---
let app, auth, db;
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getDatabase(app);
    console.log("Firebase initialized successfully.");
} catch (e) {
    console.error("Firebase initialization failed:", e);
    alert("Could not connect to Firebase.");
}

// --- DOM Elements ---
const loginModal = document.getElementById('login-modal'),
      loginForm = document.getElementById('login-form'),
      loginStatus = document.getElementById('login-status'),
      dashboard = document.getElementById('dashboard'),
      logoutBtn = document.getElementById('logout-btn'),
      statusIndicator = document.getElementById('status-indicator'),
      statusText = document.getElementById('status-text'),
      iaqGauge = document.getElementById('iaq-gauge'),
      iaqValueText = document.getElementById('iaq-value'),
      autoModeToggle = document.getElementById('auto-mode-toggle'),
      manualSprayBtn = document.getElementById('manual-spray-btn'),
      sprayStatus = document.getElementById('spray-status'),
      tempValue = document.getElementById('temp-value'),
      humidityValue = document.getElementById('humidity-value'),
      pressureValue = document.getElementById('pressure-value'),
      chartCanvas = document.getElementById('iaq-chart');

// --- System State ---
let state = {
    isAutoMode: true,
    isSpraying: false,
    iaqThreshold: 60,
    sensorUnsubscribe: null,
    chart: null,
    iaqHistory: [],
    timeHistory: [],
    // ADDED: Timestamp to track the last plot time
    lastPlotTime: 0,
};

// --- Authentication ---
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    loginStatus.textContent = "Signing in...";
    
    signInWithEmailAndPassword(auth, email, password)
        .catch(error => {
            console.error("Login failed:", error);
            loginStatus.textContent = "Login failed.";
            alert("Incorrect email or password. Please try again. 🚨");
        });
});

onAuthStateChanged(auth, user => {
    if (user) {
        loginModal.style.opacity = '0';
        setTimeout(() => {
            loginModal.classList.add('hidden');
            dashboard.classList.remove('hidden');
            initDashboard();
        }, 300);
    } else {
        dashboard.classList.add('hidden');
        loginModal.classList.remove('hidden');
        loginModal.style.opacity = '1';
        loginStatus.textContent = '';
        if (state.sensorUnsubscribe) state.sensorUnsubscribe();
    }
});

logoutBtn.addEventListener('click', () => {
    signOut(auth).catch((error) => console.error('Sign out error', error));
});


// --- Event Listeners for Controls ---
autoModeToggle.addEventListener('change', (e) => {
    const newMode = e.target.checked;
    const dbRef = ref(db, '/');
    update(dbRef, { "Automatic Mode": newMode })
        .catch(error => console.error("Failed to update Automatic Mode:", error));
});

manualSprayBtn.addEventListener('click', () => {
    if (!state.isSpraying) {
        initiateSpray('Manual');
    }
});

// --- Core Functions ---
function updateUI(data) {
    const currentIaq = parseFloat(data["Indoor Air Quality"]) || 0;
    iaqValueText.textContent = currentIaq.toFixed(2);
    iaqGauge.style.width = `${currentIaq}%`;
    tempValue.textContent = `${data.temperature ?? '--'} °F`;
    humidityValue.textContent = `${data.Humidity ?? '--'} %`;
    pressureValue.textContent = `${data.pressure ?? '--'} hPa`;

    statusIndicator.classList.remove('status-fresh', 'status-moderate', 'status-strong');
    if (currentIaq < 40) {
        statusIndicator.classList.add('status-fresh');
        statusText.textContent = 'Fresh';
    } else if (currentIaq < state.iaqThreshold) {
        statusIndicator.classList.add('status-moderate');
        statusText.textContent = 'Moderate';
    } else {
        statusIndicator.classList.add('status-strong');
        statusText.textContent = 'Strong';
    }
}

function initiateSpray(reason = 'Automatic') {
    console.log(`${reason} spray initiated for 5 seconds.`);
    const dbRef = ref(db, '/');
    update(dbRef, { spray: true })
        .then(() => {
            setTimeout(() => {
                console.log("5 seconds elapsed. Commanding spray to STOP.");
                update(dbRef, { spray: false })
                    .catch(err => console.error("Error stopping spray:", err));
            }, 5000);
        })
        .catch(err => console.error("Error initiating spray:", err));
}

// --- Chart Functions ---
function initChart() {
    if (state.chart) {
        state.chart.destroy();
    }
    const ctx = chartCanvas.getContext('2d');
    state.chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'IAQ',
                data: [],
                borderColor: '#3B82F6',
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                borderWidth: 2,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: { color: '#9CA3AF' },
                    grid: { color: 'rgba(156, 163, 175, 0.2)' }
                },
                x: {
                    ticks: { color: '#9CA3AF' },
                    grid: { color: 'rgba(156, 163, 175, 0.2)' }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function updateChart(newIaqValue) {
    const maxDataPoints = 30;
    const now = new Date().toLocaleTimeString();

    state.timeHistory.push(now);
    state.iaqHistory.push(newIaqValue);

    if (state.timeHistory.length > maxDataPoints) {
        state.timeHistory.shift();
        state.iaqHistory.shift();
    }

    if (state.chart) {
        state.chart.data.labels = state.timeHistory;
        state.chart.data.datasets[0].data = state.iaqHistory;
        state.chart.update();
    }
}


// --- Initialization ---
function initDashboard() {
    console.log("Dashboard Initialized. Listening for sensor data...");
    
    initChart();
    
    const sensorRef = ref(db, '/');
    state.sensorUnsubscribe = onValue(sensorRef, (snapshot) => {
        const defaultData = { "Indoor Air Quality": 0, temperature: 0, Humidity: 0, pressure: 0, "Automatic Mode": true, spray: false };
        const data = snapshot.val() || defaultData;
        
        // --- This UI section still updates in real-time ---
        const wasSpraying = state.isSpraying;
        state.isSpraying = data.spray === true;

        if (state.isSpraying) {
            manualSprayBtn.disabled = true;
            manualSprayBtn.classList.add('opacity-50', 'cursor-not-allowed', 'spraying-animation');
            sprayStatus.textContent = `Spraying...`;
        } else {
            manualSprayBtn.disabled = false;
            manualSprayBtn.classList.remove('opacity-50', 'cursor-not-allowed', 'spraying-animation');
            if (wasSpraying) { 
                sprayStatus.textContent = `Cycle complete.`;
                setTimeout(() => sprayStatus.textContent = '', 3000);
            }
        }
        
        const firebaseAutoMode = data["Automatic Mode"];
        state.isAutoMode = firebaseAutoMode === false ? false : true;
        autoModeToggle.checked = state.isAutoMode;
        
        const currentIaq = parseFloat(data["Indoor Air Quality"]) || 0;
        if (state.isAutoMode && !state.isSpraying && currentIaq >= state.iaqThreshold) {
            initiateSpray('Automatic');
        }
        
        updateUI(data); // UI always updates instantly
        
        // --- MODIFIED: Throttling logic for the chart ---
        const currentTime = Date.now();
        if (currentTime - state.lastPlotTime >= 60000) { // 60000ms = 1 minute
            console.log("One minute has passed. Plotting new data on the chart.");
            updateChart(currentIaq);
            state.lastPlotTime = currentTime; // Reset the timer
        }
    });
}