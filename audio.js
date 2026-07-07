// [HOOK: AUDIO_GLOBALS]
let audioCtx, masterGain;
let activeNodes = [], scheduledNotes = [], playbackTimeline = [];
let progressAnimationId, playStartTime = 0, totalDurationSec = 0, isPlaying = false, lastScheduledBeat = 0;
const audioLookaheadSec = 0.15;
const pianoBuffers = {};

let schedulerWorker;
window.customInstrumentBuffers = {}; 
let mediaRecorder = null;
let recordingChunks = [];
let currentSelectedSamplerNote = null;
let recordingTimeout = null;

// [HOOK: AUDIO_WORKER]
window.initSchedulerWorker = function() {
    const workerCode = `
        let timerID = null;
        self.onmessage = function(e) {
            if (e.data === 'start') {
                if (timerID) clearInterval(timerID);
                timerID = setInterval(() => postMessage('tick'), 25);
            } else if (e.data === 'stop') {
                clearInterval(timerID);
                timerID = null;
            }
        };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    schedulerWorker = new Worker(URL.createObjectURL(blob));
    schedulerWorker.onmessage = function(e) {
        if (e.data === 'tick' && isPlaying) window.scheduleAudioNotes();
    };
}

// [HOOK: AUDIO_ENGINE]
window.initAudioEngine = async function() {
    if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    if (!masterGain) { masterGain = audioCtx.createGain(); masterGain.gain.value = 1.0; masterGain.connect(audioCtx.destination); }

    const statusEl = document.getElementById('audioStatus');
    statusEl.innerText = "Scaricando... ⏳"; statusEl.style.color = "#8be9fd";
    
    try {
        let baseUrl = document.getElementById('audioSourceSelect').value.trim();
        if(!baseUrl.endsWith('/') && !baseUrl.endsWith('%2F')) baseUrl += '/';
        const promises = window.activeMidi30.map(async (midi, i) => {
            let url = baseUrl + window.noteNames30[i] + ".mp3";
            if (baseUrl.includes("firebasestorage")) url += "?alt=media";
            const response = await fetch(url, { mode: 'cors' });
            pianoBuffers[midi] = await audioCtx.decodeAudioData(await response.arrayBuffer());
        });
        await Promise.all(promises);
        statusEl.innerText = "Pronto ✅"; statusEl.style.color = "#50fa7b";
    } catch (err) { statusEl.innerText = "Errore ❌"; statusEl.style.color = "#ff5555"; }
};

window.testAudioNote = async function() {
    if (!audioCtx) await window.initAudioEngine();
    if (Object.keys(pianoBuffers).length === 0) return alert("Carica i suoni!");
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    window.playSampledNote(60, audioCtx.currentTime, 1.5, 1.0, 'manual'); 
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

// [HOOK: SAMPLER_RECORDER]
window.toggleRecording = async function() {
    if (!currentSelectedSamplerNote) return alert("Seleziona prima una nota!");
    const noteName = currentSelectedSamplerNote.name;
    const btn = document.getElementById('btn-rec-modal');
    
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop(); btn.classList.remove('recording-pulse'); btn.innerText = "🎤 Registra Microfono"; clearTimeout(recordingTimeout); return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream); recordingChunks = [];
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordingChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            window.customInstrumentBuffers[noteName] = new Blob(recordingChunks, { type: 'audio/webm' }); 
            btn.classList.remove('recording-pulse'); btn.innerText = "🎤 Registra Microfono";
            window.updateSamplerProgress(); stream.getTracks().forEach(track => track.stop());
        };
        mediaRecorder.start(); btn.classList.add('recording-pulse'); btn.innerText = "⏹ Ferma Registrazione";
        recordingTimeout = setTimeout(() => { if (mediaRecorder.state === 'recording') { mediaRecorder.stop(); alert("Limite di 25s raggiunto."); } }, 25000);
    } catch (err) { alert("Errore microfono."); }
};

window.handleUploadNote = function(event) {
    if (!currentSelectedSamplerNote) return alert("Seleziona una nota!");
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => { window.customInstrumentBuffers[currentSelectedSamplerNote.name] = new Blob([e.target.result], { type: file.type }); window.updateSamplerProgress(); };
    reader.readAsArrayBuffer(file);
};

window.exportInstrumentZip = function() {
    if (Object.keys(window.customInstrumentBuffers).length === 0) return alert("Non hai registrato note!");
    const zip = new JSZip();
    for (const [note, blob] of Object.entries(window.customInstrumentBuffers)) zip.file(`${note}.mp3`, blob); 
    zip.generateAsync({type:"blob"}).then(content => {
        const a = document.createElement("a"); a.href = URL.createObjectURL(content); a.download = "strumento_piano_custom.zip"; a.click();
    });
};