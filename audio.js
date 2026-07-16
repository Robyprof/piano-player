// START OF FILE audio.js
// [HOOK: AUDIO_GLOBALS]
let audioCtx, masterGain;
let activeNodes = [], scheduledNotes = [], playbackTimeline = [];
let progressAnimationId, playStartTime = 0, totalDurationSec = 0, isPlaying = false, lastScheduledBeat = 0;
const audioLookaheadSec = 0.15;
const pianoBuffers = {};
let schedulerWorker;
window.customInstrumentBuffers = {}; 
// Variabili Campionatore...
let micStream = null, scriptProcessor = null, biquadFilter = null, analyserNode = null, recordedPCMChunks = [];
let isMicRecording = false, isWaitingForTrigger = false, drawVisualId = null;
let currentSelectedSamplerNote = null, recordingTimeout = null, timerInterval = null;

window.loadLamejs = function() {
    return new Promise((resolve, reject) => {
        if (window.lamejs) return resolve(window.lamejs);
        const script = document.createElement('script');
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js";
        script.onload = () => resolve(window.lamejs);
        document.head.appendChild(script);
    });
};

window.initSchedulerWorker = function() {
    const workerCode = `let timerID = null; self.onmessage = function(e) { if (e.data === 'start') { if (timerID) clearInterval(timerID); timerID = setInterval(() => postMessage('tick'), 25); } else if (e.data === 'stop') { clearInterval(timerID); timerID = null; } };`;
    schedulerWorker = new Worker(URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' })));
    schedulerWorker.onmessage = function(e) { if (e.data === 'tick' && isPlaying) window.scheduleAudioNotes(); };
}

window.initAudioEngine = async function() {
    if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext(); // Può partire in 'suspended', è normale.
    }
    if (!masterGain) { masterGain = audioCtx.createGain(); masterGain.gain.value = 1.0; masterGain.connect(audioCtx.destination); }

    const statusEl = document.getElementById('audioStatus');
    statusEl.innerText = "Caricamento in Background... ⏳"; statusEl.style.color = "#f59e0b";
    
    try {
        let baseUrl = document.getElementById('audioSourceSelect').value.trim();
        if(!baseUrl.endsWith('/') && !baseUrl.endsWith('%2F')) baseUrl += '/';
        const promises = window.activeMidi30.map(async (midi, i) => {
            let url = baseUrl + window.noteNames30[i] + ".mp3";
            const response = await fetch(url, { mode: 'cors' });
            pianoBuffers[midi] = await audioCtx.decodeAudioData(await response.arrayBuffer());
        });
        await Promise.all(promises);
        statusEl.innerText = "Pronto all'Uso ✅"; statusEl.style.color = "#10b981";
    } catch (err) { statusEl.innerText = "Errore Rete ❌"; statusEl.style.color = "#ef4444"; }
};

window.playSampledNote = function(midi, startTime, duration, volume, type) {
    if (!audioCtx || Object.keys(pianoBuffers).length === 0) return;
    let nearestMidi = 60, minDiff = Infinity;
    for (const m of Object.keys(pianoBuffers)) {
        const diff = Math.abs(midi - parseInt(m));
        if (diff < minDiff) { minDiff = diff; nearestMidi = parseInt(m); }
    }
    const buffer = pianoBuffers[nearestMidi];
    if (!buffer) return;

    const source = audioCtx.createBufferSource();
    source.buffer = buffer; source.playbackRate.value = Math.pow(2, (midi - nearestMidi) / 12); 
    const gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(0, startTime); gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.015);
    gainNode.gain.setValueAtTime(volume, startTime + duration); gainNode.gain.linearRampToValueAtTime(0, startTime + duration + 0.5); 
    source.connect(gainNode); gainNode.connect(masterGain); 
    source.start(startTime); source.stop(startTime + duration + 0.5); 
    activeNodes.push(source);
    if(type !== 'manual') scheduledNotes.push({ midi, start: startTime, end: startTime + duration, type });
};

window.scheduleAudioNotes = function() {
    if (!isPlaying || !audioCtx) return;
    const now = audioCtx.currentTime; const elapsed = now - playStartTime;
    const bpm = parseFloat(document.getElementById('bpmSlider').value);
    const beatDuration = 60 / bpm; 
    const nextWindowStart = lastScheduledBeat;
    const nextWindowEnd = (elapsed / beatDuration) + (audioLookaheadSec / beatDuration);
    const useRhythm = document.getElementById('rhythmToggle').checked;
    const useMelody = document.getElementById('melodyToggle').checked;

    while (playbackTimeline.length > 0 && playbackTimeline[0].beat < nextWindowEnd) {
        const event = playbackTimeline.shift();
        if (event.beat >= nextWindowStart) {
            if (event.type === 'chord' && !useRhythm) continue;
            if (event.type === 'melody' && !useMelody) continue;
            window.playSampledNote(event.midi, playStartTime + (event.beat * beatDuration), event.durationBeats * beatDuration, event.volume, event.type);
        }
    }
    lastScheduledBeat = nextWindowEnd;
};

// ... (Il resto delle logiche di oscilloscopio e MP3 rimane immutato) ...