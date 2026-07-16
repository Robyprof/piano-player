// START OF FILE audio.js
let audioCtx, masterGain;
let activeNodes = [], scheduledNotes = [], playbackTimeline = [];
let progressAnimationId, playStartTime = 0, totalDurationSec = 0, isPlaying = false, lastScheduledBeat = 0;
const audioLookaheadSec = 0.15;
const pianoBuffers = {};

let schedulerWorker;
window.customInstrumentBuffers = {}; 
window.mediaRecorder = null; 
let currentSelectedSamplerNote = null;
let recordingTimeout = null;
let timerInterval = null; 

let micStream = null;
let scriptProcessor = null;
let biquadFilter = null;
let analyserNode = null;
let recordedPCMChunks = [];
let isMicRecording = false;
let isWaitingForTrigger = false;
let drawVisualId = null;

window.loadLamejs = function() {
    return new Promise((resolve, reject) => {
        if (window.lamejs) { resolve(window.lamejs); return; }
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
        audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    if (!masterGain) { masterGain = audioCtx.createGain(); masterGain.gain.value = 1.0; masterGain.connect(audioCtx.destination); }

    const statusEl = document.getElementById('audioStatus');
    if(statusEl) { statusEl.innerText = "Scaricando... ⏳"; statusEl.style.color = "#f59e0b"; }
    
    try {
        let baseUrl = document.getElementById('audioSourceSelect').value.trim();
        if(!baseUrl.endsWith('/') && !baseUrl.endsWith('%2F')) baseUrl += '/';
        const promises = window.activeMidi30.map(async (midi, i) => {
            let url = baseUrl + window.noteNames30[i] + ".mp3";
            const response = await fetch(url, { mode: 'cors' });
            pianoBuffers[midi] = await audioCtx.decodeAudioData(await response.arrayBuffer());
        });
        await Promise.all(promises);
        if(statusEl) { statusEl.innerText = "Pronto ✅"; statusEl.style.color = "#10b981"; }
    } catch (err) { if(statusEl) { statusEl.innerText = "Errore ❌"; statusEl.style.color = "#ef4444"; } }
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

// ==========================================
// FUNZIONI DEL CAMPIONATORE (RECORDING)
// ==========================================
window.populateMicDropdown = async function() {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const select = document.getElementById('samplerMicSelect');
        if (!select) return;
        
        select.innerHTML = '';
        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        audioInputs.forEach((device, index) => {
            const opt = document.createElement('option');
            opt.value = device.deviceId; opt.textContent = device.label || `Microfono ${index + 1}`;
            select.appendChild(opt);
        });
    } catch (err) { console.error("Errore microfoni:", err); }
};

window.drawRealTimeWave = function() {
    if (!isMicRecording && !isWaitingForTrigger) { if (drawVisualId) cancelAnimationFrame(drawVisualId); return; }
    drawVisualId = requestAnimationFrame(window.drawRealTimeWave);
    const canvas = document.getElementById('samplerWaveformCanvas');
    if (!canvas || !analyserNode) return;
    
    const ctx = canvas.getContext('2d');
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserNode.getByteTimeDomainData(dataArray);
    
    ctx.fillStyle = '#050608';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2.5; ctx.strokeStyle = isWaitingForTrigger ? '#f59e0b' : '#10b981'; 
    ctx.beginPath();
    
    const sliceWidth = canvas.width / bufferLength; let x = 0;
    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0; const y = v * canvas.height / 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        x += sliceWidth;
    }
    ctx.lineTo(canvas.width, canvas.height / 2); ctx.stroke();
};

window.drawStaticWaveform = function(pcmArray) {
    const canvas = document.getElementById('samplerWaveformCanvas'); if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050608'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#a78bfa'; ctx.beginPath();
    
    const step = Math.ceil(pcmArray.length / canvas.width); ctx.moveTo(0, canvas.height / 2);
    for (let i = 0; i < canvas.width; i++) {
        let min = 1.0, max = -1.0;
        for (let j = 0; j < step; j++) {
            const idx = (i * step) + j; if (idx >= pcmArray.length) break;
            if (pcmArray[idx] < min) min = pcmArray[idx]; if (pcmArray[idx] > max) max = pcmArray[idx];
        }
        ctx.lineTo(i, (1 + min) * canvas.height / 2); ctx.lineTo(i, (1 + max) * canvas.height / 2);
    }
    ctx.stroke();
};

window.clearWaveformCanvas = function() {
    const canvas = document.getElementById('samplerWaveformCanvas'); if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050608'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#2b3145'; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2); ctx.lineTo(canvas.width, canvas.height / 2); ctx.stroke();
};

window.toggleRecording = async function() {
    if (!window.currentSelectedSamplerNote) return alert("Seleziona prima una nota!");
    try { await window.loadLamejs(); } catch (err) { return alert(err.message); }
    
    const noteName = window.currentSelectedSamplerNote.name;
    const btn = document.getElementById('btn-rec-modal');
    
    if (isWaitingForTrigger || isMicRecording) {
        if (recordingTimeout) clearTimeout(recordingTimeout);
        if (timerInterval) clearInterval(timerInterval);
        if (drawVisualId) cancelAnimationFrame(drawVisualId);
        
        const timerEl = document.getElementById('samplerTimer');
        if (timerEl) timerEl.style.display = 'none';

        const wasRecording = isMicRecording;
        isWaitingForTrigger = false; isMicRecording = false;
        
        btn.classList.remove('recording-pulse', 'waiting-pulse'); 
        btn.innerText = "🎤 Registra Microfono";
        
        if (scriptProcessor) { scriptProcessor.disconnect(); scriptProcessor = null; }
        if (biquadFilter) { biquadFilter.disconnect(); biquadFilter = null; }
        if (analyserNode) { analyserNode.disconnect(); analyserNode = null; }
        if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
        
        if (!wasRecording || recordedPCMChunks.length === 0) { window.clearWaveformCanvas(); return; }
        
        const sampleRate = audioCtx ? audioCtx.sampleRate : 44100;
        const totalTargetLength = 25 * sampleRate;
        let float32PCM = new Float32Array(totalTargetLength); 
        
        let offset = 0;
        for (let chunk of recordedPCMChunks) {
            if (offset + chunk.length > totalTargetLength) {
                float32PCM.set(chunk.subarray(0, totalTargetLength - offset), offset); break;
            }
            float32PCM.set(chunk, offset); offset += chunk.length;
        }
        
        // Analizzatore e taglio silenzio
        let maxPeak = 0, maxPeakIndex = 0;
        for (let i = 0; i < float32PCM.length; i++) {
            const val = Math.abs(float32PCM[i]); if (val > maxPeak) { maxPeak = val; maxPeakIndex = i; }
        }
        
        let startCutIndex = 0;
        if (maxPeak > 0.02) {
            const startThreshold = maxPeak * 0.05;
            for (let i = maxPeakIndex; i >= 0; i--) {
                if (Math.abs(float32PCM[i]) < startThreshold) { startCutIndex = i; break; }
            }
        }
        
        if (startCutIndex > 0) {
            let trimmed = new Float32Array(totalTargetLength);
            trimmed.set(float32PCM.subarray(startCutIndex), 0);
            float32PCM = trimmed;
        }
        
        for (let i = 0; i < float32PCM.length; i++) { if (Math.abs(float32PCM[i]) < 0.005) float32PCM[i] = 0.0; }
        window.drawStaticWaveform(float32PCM);
        
        let int16PCM = new Int16Array(float32PCM.length);
        for (let i = 0; i < float32PCM.length; i++) {
            let s = Math.max(-1, Math.min(1, float32PCM[i]));
            int16PCM[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        try {
            const mp3encoder = new lamejs.Mp3Encoder(1, sampleRate, 128);
            const mp3Data = [];
            for (let i = 0; i < int16PCM.length; i += 1152) {
                const chunk = int16PCM.subarray(i, i + 1152);
                const mp3buf = mp3encoder.encodeBuffer(chunk);
                if (mp3buf.length > 0) mp3Data.push(mp3buf);
            }
            const mp3buf = mp3encoder.flush(); if (mp3buf.length > 0) mp3Data.push(mp3buf);
            
            const mp3Blob = new Blob(mp3Data, { type: 'audio/mp3' });
            window.customInstrumentBuffers[noteName] = mp3Blob;
            window.updateSamplerProgress();
            if (window.playRecordedSample) window.playRecordedSample(noteName);
        } catch (e) { alert("Errore encoding MP3."); }
        return;
    }

    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        
        const micSelect = document.getElementById('samplerMicSelect');
        const deviceId = micSelect ? micSelect.value : undefined;
        micStream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
        
        const source = audioCtx.createMediaStreamSource(micStream);
        biquadFilter = audioCtx.createBiquadFilter(); biquadFilter.type = "highpass"; biquadFilter.frequency.value = 80; 
        analyserNode = audioCtx.createAnalyser(); analyserNode.fftSize = 2048;
        scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1);
        
        recordedPCMChunks = []; isWaitingForTrigger = true; isMicRecording = false;
        btn.classList.add('waiting-pulse'); btn.innerText = "🎙 In attesa suono (suona tasto)...";
        
        scriptProcessor.onaudioprocess = function(e) {
            const inputData = e.inputBuffer.getChannelData(0);
            if (isWaitingForTrigger) {
                let maxVal = 0;
                for (let i = 0; i < inputData.length; i++) { if (Math.abs(inputData[i]) > maxVal) maxVal = Math.abs(inputData[i]); }
                
                const triggerSlider = document.getElementById('samplerThresholdSlider');
                const activeThreshold = triggerSlider ? parseFloat(triggerSlider.value) : 0.05;
                
                if (maxVal > activeThreshold) {
                    isWaitingForTrigger = false; isMicRecording = true;
                    const durationLimit = parseInt(document.getElementById('samplerDurationSlider').value, 10) || 25;
                    
                    setTimeout(() => {
                        btn.classList.remove('waiting-pulse'); btn.classList.add('recording-pulse'); btn.innerText = "⏹ Ferma Registrazione";
                        const timerEl = document.getElementById('samplerTimer');
                        if (timerEl) { timerEl.style.display = 'inline-block'; timerEl.innerText = `⏱️ 0.0s / ${durationLimit}s`; }
                    }, 0);
                    
                    let recordStartTime = Date.now();
                    timerInterval = setInterval(() => {
                        if (!isMicRecording) { clearInterval(timerInterval); return; }
                        let elapsed = (Date.now() - recordStartTime) / 1000;
                        if (elapsed > durationLimit) elapsed = durationLimit;
                        const timerEl = document.getElementById('samplerTimer');
                        if (timerEl) timerEl.innerText = `⏱️ ${elapsed.toFixed(1)}s / ${durationLimit}s`;
                    }, 100);
                    
                    recordingTimeout = setTimeout(() => { if (isMicRecording) window.toggleRecording(); }, durationLimit * 1000);
                }
            }
            if (isMicRecording) recordedPCMChunks.push(new Float32Array(inputData));
        };
        
        source.connect(biquadFilter); biquadFilter.connect(analyserNode); analyserNode.connect(scriptProcessor); scriptProcessor.connect(audioCtx.destination);
        window.drawRealTimeWave();
        
    } catch (err) { alert("Impossibile accedere al microfono."); }
};

window.handleUploadNote = function(event) {
    if (!window.currentSelectedSamplerNote) return alert("Seleziona una nota!");
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => { window.customInstrumentBuffers[window.currentSelectedSamplerNote.name] = new Blob([e.target.result], { type: file.type }); window.updateSamplerProgress(); };
    reader.readAsArrayBuffer(file);
};

window.exportInstrumentZip = function() {
    if (Object.keys(window.customInstrumentBuffers).length < 30) return alert("Devi prima registrare tutte e 30 le note!");
    const zip = new JSZip();
    for (const [note, blob] of Object.entries(window.customInstrumentBuffers)) zip.file(`${note}.mp3`, blob); 
    zip.generateAsync({type:"blob"}).then(content => {
        const a = document.createElement("a"); a.href = URL.createObjectURL(content); a.download = "strumento_piano_custom.zip"; a.click();
    });
};

window.playRecordedSample = async function(noteName) {
    const blob = window.customInstrumentBuffers[noteName];
    if (!blob) return;
    try {
        const audio = new Audio(URL.createObjectURL(blob)); audio.play();
    } catch (e) { console.error("Errore playback", e); }
};
// END OF FILE audio.js