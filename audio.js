// [HOOK: AUDIO_GLOBALS]
let audioCtx, masterGain;
let activeNodes = [], scheduledNotes = [], playbackTimeline = [];
let progressAnimationId, playStartTime = 0, totalDurationSec = 0, isPlaying = false, lastScheduledBeat = 0;
const audioLookaheadSec = 0.15;
const pianoBuffers = {};

let schedulerWorker;
window.customInstrumentBuffers = {}; 
window.mediaRecorder = null; 
let recordingChunks = [];
let currentSelectedSamplerNote = null;
let recordingTimeout = null;

// Gestione Registrazione MP3 Nativizzata, Selezione Mic e Soglia di Attivazione
let micStream = null;
let scriptProcessor = null;
let recordedPCMChunks = [];
let isMicRecording = false;
let isWaitingForTrigger = false;
const triggerThreshold = 0.02; // Soglia minima per rilevare il suono netto del pianoforte

// Funzione di caricamento sicuro e resiliente per lamejs (con fallback automatico multi-CDN)
window.loadLamejs = function() {
    return new Promise((resolve, reject) => {
        if (window.lamejs) {
            resolve(window.lamejs);
            return;
        }
        // Sorgenti CDN alternative ordinate per affidabilità
        const urls = [
            "https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js",
            "https://unpkg.com/lamejs@1.2.1/lame.min.js",
            "https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js"
        ];
        let index = 0;
        function tryNext() {
            if (index >= urls.length) {
                reject(new Error("Errore: Impossibile caricare la libreria lamejs da nessuna delle sorgenti CDN. Verifica la tua connessione internet."));
                return;
            }
            const script = document.createElement('script');
            script.src = urls[index];
            script.onload = () => {
                if (window.lamejs) {
                    console.log("lamejs caricato correttamente da: " + urls[index]);
                    resolve(window.lamejs);
                } else {
                    index++;
                    tryNext();
                }
            };
            script.onerror = () => {
                console.warn("Failing to load lamejs from: " + urls[index] + " - Provando la sorgente successiva...");
                index++;
                tryNext();
            };
            document.head.appendChild(script);
        }
        tryNext();
    });
};

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
            opt.value = device.deviceId;
            opt.textContent = device.label || `Microfono ${index + 1}`;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error("Errore nell'accesso o enumerazione dei microfoni:", err);
    }
};

window.toggleRecording = async function() {
    if (!currentSelectedSamplerNote) return alert("Seleziona prima una nota!");
    
    // Assicura il caricamento corretto di lamejs prima della registrazione
    try {
        await window.loadLamejs();
    } catch (err) {
        return alert(err.message);
    }

    const noteName = currentSelectedSamplerNote.name;
    const btn = document.getElementById('btn-rec-modal');
    
    // Se stiamo aspettando il trigger o registrando attivamente, il click ferma l'intera sessione
    if (isWaitingForTrigger || isMicRecording) {
        if (recordingTimeout) {
            clearTimeout(recordingTimeout);
            recordingTimeout = null;
        }

        const wasRecording = isMicRecording;
        isWaitingForTrigger = false;
        isMicRecording = false;
        
        btn.classList.remove('recording-pulse', 'waiting-pulse'); 
        btn.innerText = "🎤 Registra Microfono";
        
        if (scriptProcessor) {
            scriptProcessor.disconnect();
            scriptProcessor = null;
        }
        if (micStream) {
            micStream.getTracks().forEach(track => track.stop());
            micStream = null;
        }
        
        // Se la registrazione è stata chiusa manualmente prima del trigger, non salviamo dati vuoti
        if (!wasRecording || recordedPCMChunks.length === 0) {
            console.log("Registrazione annullata prima del rilevamento del suono.");
            return;
        }
        
        // Assembla i campioni Float32 accumulati
        let totalLength = recordedPCMChunks.reduce((acc, val) => acc + val.length, 0);
        let float32PCM = new Float32Array(totalLength);
        let offset = 0;
        for (let chunk of recordedPCMChunks) {
            float32PCM.set(chunk, offset);
            offset += chunk.length;
        }
        
        // Conversione in formato Int16 per l'encoder
        let int16PCM = new Int16Array(float32PCM.length);
        for (let i = 0; i < float32PCM.length; i++) {
            let s = Math.max(-1, Math.min(1, float32PCM[i]));
            int16PCM[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        try {
            const sampleRate = audioCtx ? audioCtx.sampleRate : 44100;
            const mp3encoder = new lamejs.Mp3Encoder(1, sampleRate, 128);
            const mp3Data = [];
            const sampleBlockSize = 1152;
            
            for (let i = 0; i < int16PCM.length; i += sampleBlockSize) {
                const chunk = int16PCM.subarray(i, i + sampleBlockSize);
                const mp3buf = mp3encoder.encodeBuffer(chunk);
                if (mp3buf.length > 0) {
                    mp3Data.push(mp3buf);
                }
            }
            const mp3buf = mp3encoder.flush();
            if (mp3buf.length > 0) {
                mp3Data.push(mp3buf);
            }
            
            const mp3Blob = new Blob(mp3Data, { type: 'audio/mp3' });
            window.customInstrumentBuffers[noteName] = mp3Blob;
            window.updateSamplerProgress();
            
            if (window.playRecordedSample) {
                window.playRecordedSample(noteName);
            }
        } catch (e) {
            console.error(e);
            alert("Errore durante l'encoding MP3.");
        }
        return;
    }

    // Avvio della sessione in modalità ascolto di trigger
    try {
        if (!audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AudioContext();
        }
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        
        const micSelect = document.getElementById('samplerMicSelect');
        const deviceId = micSelect ? micSelect.value : undefined;
        
        const constraints = {
            audio: deviceId ? { deviceId: { exact: deviceId } } : true
        };
        
        micStream = await navigator.mediaDevices.getUserMedia(constraints);
        const source = audioCtx.createMediaStreamSource(micStream);
        
        scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1);
        recordedPCMChunks = [];
        isWaitingForTrigger = true;
        isMicRecording = false;
        
        btn.classList.add('waiting-pulse'); 
        btn.innerText = "🎙 In attesa del suono (suona il tasto)...";
        
        scriptProcessor.onaudioprocess = function(e) {
            const inputData = e.inputBuffer.getChannelData(0);
            
            if (isWaitingForTrigger) {
                let maxVal = 0;
                for (let i = 0; i < inputData.length; i++) {
                    const val = Math.abs(inputData[i]);
                    if (val > maxVal) maxVal = val;
                }
                
                // Se viene rilevato un suono netto che supera la soglia, comincia la registrazione
                if (maxVal > triggerThreshold) {
                    isWaitingForTrigger = false;
                    isMicRecording = true;
                    
                    // Modifica asincrona sicura per il thread grafico principale
                    setTimeout(() => {
                        btn.classList.remove('waiting-pulse');
                        btn.classList.add('recording-pulse');
                        btn.innerText = "⏹ Registrazione attiva... (Max 25s)";
                    }, 0);
                    
                    // Imposta lo stop automatico a 25 secondi dall'istante di trigger
                    recordingTimeout = setTimeout(() => {
                        if (isMicRecording) {
                            window.toggleRecording(); 
                        }
                    }, 25000);
                }
            }
            
            if (isMicRecording) {
                recordedPCMChunks.push(new Float32Array(inputData));
            }
        };
        
        source.connect(scriptProcessor);
        scriptProcessor.connect(audioCtx.destination);
        
    } catch (err) {
        console.error(err);
        alert("Impossibile accedere al microfono selezionato.");
    }
};

window.handleUploadNote = function(event) {
    if (!currentSelectedSamplerNote) return alert("Seleziona una nota!");
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => { window.customInstrumentBuffers[currentSelectedSamplerNote.name] = new Blob([e.target.result], { type: file.type }); window.updateSamplerProgress(); };
    reader.readAsArrayBuffer(file);
};

window.exportInstrumentZip = function() {
    if (Object.keys(window.customInstrumentBuffers).length < 30) {
        return alert("Devi prima registrare tutte e 30 le note per poter archiviare lo strumento!");
    }
    const zip = new JSZip();
    for (const [note, blob] of Object.entries(window.customInstrumentBuffers)) zip.file(`${note}.mp3`, blob); 
    zip.generateAsync({type:"blob"}).then(content => {
        const a = document.createElement("a"); a.href = URL.createObjectURL(content); a.download = "strumento_piano_custom.zip"; a.click();
    });
};

// [HOOK: PLAY_RECORDED_SAMPLE]
window.playRecordedSample = async function(noteName) {
    const blob = window.customInstrumentBuffers[noteName];
    if (!blob) {
        const midi = window.activeMidi30[window.noteNames30.indexOf(noteName)];
        if (pianoBuffers[midi]) {
            window.playSampledNote(midi, audioCtx.currentTime, 1.5, 1.0, 'manual');
        } else {
            console.log("Audio di default non ancora caricato per midi:", midi);
        }
        return;
    }
    try {
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        audio.play();
    } catch (e) {
        console.error("Errore durante la riproduzione del campione registrato:", e);
    }
};