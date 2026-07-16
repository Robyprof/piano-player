// ==========================================
// START OF FILE ui.js
// ==========================================

let synthCanvas, synthCtx, canvasMap = {};
let staffCanvas, staffCtx;
const lookaheadSec = 4.0; 
let currentTrebleNotes = [], currentBassNotes = [];

window.midiToDiatonicStep = function(midi) { 
    const octave = Math.floor(midi / 12) - 1; 
    const noteClass = midi % 12; 
    const cMajOffsets = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]; 
    return octave * 7 + cMajOffsets[noteClass]; 
};

// ==========================================
// 1. GENERAZIONE TASTIERA PRINCIPALE
// ==========================================
window.buildMainKeyboard = function() {
    const keyboard = document.getElementById('keyboard');
    const notesMap = [ { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: true }, { isBlack: false } ];
    let totalWhiteKeys = 0; const whiteKeyIndices = {};
    for (let m = window.startMidi; m <= window.endMidi; m++) if (!notesMap[m % 12].isBlack) whiteKeyIndices[m] = totalWhiteKeys++;

    if (keyboard) {
        keyboard.innerHTML = `<div class="white-keys-container" id="whiteKeys"></div><div class="black-keys-container" id="blackKeys"></div>`;
        for (let m = window.startMidi; m <= window.endMidi; m++) {
            const isBlack = notesMap[m % 12].isBlack;
            let keyDiv = document.createElement('div'); keyDiv.dataset.midi = m;
            if (!isBlack) { keyDiv.className = 'key-white'; document.getElementById('whiteKeys').appendChild(keyDiv); } 
            else { keyDiv.className = 'key-black'; keyDiv.style.left = `${((whiteKeyIndices[m - 1] + 1) / totalWhiteKeys) * 100}%`; keyDiv.style.transform = 'translateX(-50%)'; keyDiv.style.pointerEvents = 'auto'; document.getElementById('blackKeys').appendChild(keyDiv); }

            const pressKey = async (e) => { e.preventDefault(); if (typeof audioCtx !== 'undefined' && audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); keyDiv.classList.add('active-key', 'manual-active'); window.playSampledNote(m, typeof audioCtx !== 'undefined' && audioCtx ? audioCtx.currentTime : 0, 1.5, 1.2, 'manual'); };
            const releaseKey = (e) => { e.preventDefault(); keyDiv.classList.remove('active-key', 'manual-active'); };
            keyDiv.addEventListener('mousedown', pressKey); keyDiv.addEventListener('touchstart', pressKey);
            keyDiv.addEventListener('mouseup', releaseKey); keyDiv.addEventListener('mouseleave', releaseKey); keyDiv.addEventListener('touchend', releaseKey);
        }
    }
};

// ==========================================
// 2. LOGICA ORIGINALE DEL CAMPIONATORE (COLORI CORRETTI)
// ==========================================
window.renderSamplerKeyboard = function() {
    const kb = document.getElementById('samplerKeyboardGen');
    if (!kb) return;
    kb.innerHTML = '';
    
    kb.className = "keyboard sampler-mode"; 
    
    const notesMap = [ { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: true }, { isBlack: false } ];
    let totalWhiteKeys = 0; const whiteKeyIndices = {};
    for (let m = window.startMidi; m <= window.endMidi; m++) if (!notesMap[m % 12].isBlack) whiteKeyIndices[m] = totalWhiteKeys++;

    kb.innerHTML = `<div class="white-keys-container" id="samplerWhiteKeys"></div><div class="black-keys-container" id="blackKeysSampler" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;"></div>`;

    for (let m = window.startMidi; m <= window.endMidi; m++) {
        const isBlack = notesMap[m % 12].isBlack;
        const isActive30 = window.activeMidi30.includes(m);
        const noteName = isActive30 ? window.noteNames30[window.activeMidi30.indexOf(m)] : '';

        let keyDiv = document.createElement('div'); keyDiv.id = `s-key-${m}`;
        
        if (!isBlack) {
            keyDiv.className = `key-white ${isActive30 ? 's-active' : 's-inactive'}`;
            // COLORE STANDARD TASTI BIANCHI (Nessuna trasparenza)
            keyDiv.style.background = isActive30 ? "#ffffff" : "#d1d5db";
            keyDiv.style.opacity = "1"; 
            keyDiv.style.pointerEvents = isActive30 ? "auto" : "none";

            if (isActive30) keyDiv.innerHTML = `<span class="s-label" style="position: absolute; bottom: 8px; width: 100%; text-align: center; font-size: 10px; font-weight: bold; color: #000;">${noteName}</span>`;
            document.getElementById('samplerWhiteKeys').appendChild(keyDiv);
        } else {
            keyDiv.className = `key-black ${isActive30 ? 's-active' : 's-inactive'}`;
            // COLORE STANDARD TASTI NERI (Nessuna trasparenza)
            keyDiv.style.background = isActive30 ? "#111111" : "#374151";
            keyDiv.style.opacity = "1"; 
            keyDiv.style.pointerEvents = isActive30 ? "auto" : "none";

            keyDiv.style.left = `${((whiteKeyIndices[m - 1] + 1) / totalWhiteKeys) * 100}%`; 
            keyDiv.style.transform = 'translateX(-50%)';
            
            if (isActive30) keyDiv.innerHTML = `<span class="s-label" style="position: absolute; bottom: 10px; width: 100%; text-align: center; font-size: 9px; font-weight: bold; color: #fff;">${noteName}</span>`;
            document.getElementById('blackKeysSampler').appendChild(keyDiv);
        }

        if (isActive30) {
            keyDiv.onmousedown = () => window.selectSamplerNote(m, noteName);
            keyDiv.ontouchstart = (e) => { e.preventDefault(); window.selectSamplerNote(m, noteName); };
        }
    }
};

window.openSamplerModal = function() {
    document.getElementById('samplerModal').style.display = 'flex';
    window.renderSamplerKeyboard(); 
    window.updateSamplerProgress();
    document.getElementById('samplerActionPanel').style.display = 'none';
    if (window.populateMicDropdown) window.populateMicDropdown();
};

window.closeSamplerModal = function() { 
    document.getElementById('samplerModal').style.display = 'none'; 
    if (typeof isMicRecording !== 'undefined' && isMicRecording && window.toggleRecording) window.toggleRecording();
};

window.selectSamplerNote = function(midi, name) {
    // SBLOCCO POLICY BROWSER: Risveglia l'audio al click
    if (typeof audioCtx !== 'undefined' && audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); 

    if (typeof window.currentSelectedSamplerNote !== 'undefined' && window.currentSelectedSamplerNote) {
        const oldKey = document.getElementById(`s-key-${window.currentSelectedSamplerNote.midi}`);
        if (oldKey) oldKey.classList.remove('s-selected');
    }
    
    window.currentSelectedSamplerNote = { midi, name };
    const newKey = document.getElementById(`s-key-${midi}`);
    if (newKey) {
        newKey.classList.add('s-selected');
        // Forza background color originale rosa acceso al click
        newKey.style.background = "#ff79c6"; 
    }

    const label = document.getElementById('samplerSelectedNoteLabel');
    if (label) label.innerText = `Registrazione in corso per la Nota: ${name} 🎹`;
    
    document.getElementById('samplerActionPanel').style.display = 'block';

    const btn = document.getElementById('btn-rec-modal');
    if (btn) {
        if (typeof isMicRecording !== 'undefined' && isMicRecording && window.toggleRecording) { window.toggleRecording(); }
        btn.classList.remove('recording-pulse'); btn.innerText = "🎤 Registra Microfono";
    }

    // Mostra/Nascondi il visualizzatore ed ascolto del campione registrato
    const playbackRow = document.getElementById('samplerPlaybackRow');
    const playbackLabel = document.getElementById('samplerPlaybackNoteLabel');
    if (playbackRow && playbackLabel) {
        playbackLabel.innerText = `Nota selezionata: ${name} 🎵`;
        if (window.customInstrumentBuffers && window.customInstrumentBuffers[name]) {
            playbackRow.style.display = 'flex';
        } else {
            playbackRow.style.display = 'none';
        }
    }

    // Illumina il tasto quando viene selezionato/riprodotto
    if (newKey) {
        newKey.style.boxShadow = "inset 0 -15px 25px rgba(255, 255, 255, 0.6), 0 0 15px #bd93f9";
        setTimeout(() => {
            newKey.style.boxShadow = "";
            newKey.style.background = ""; // Ripristina colore in base a updateSamplerProgress
            window.updateSamplerProgress(); // Forza l'aggiornamento colore per sicurezza
        }, 1500);
    }

    if (window.playRecordedSample) {
        window.playRecordedSample(name);
    }
};

window.playAndLightSelectedSample = async function() {
    if (!window.currentSelectedSamplerNote) return;
    const name = window.currentSelectedSamplerNote.name;
    const midi = window.currentSelectedSamplerNote.midi;
    
    if (window.playRecordedSample) {
        window.playRecordedSample(name);
    }
    
    // Feedback luminoso del tasto associato sulla tastiera del campionatore
    const keyEl = document.getElementById(`s-key-${midi}`);
    if (keyEl) {
        keyEl.style.boxShadow = "inset 0 -15px 25px rgba(255, 255, 255, 0.6), 0 0 15px #bd93f9";
        setTimeout(() => { keyEl.style.boxShadow = ""; }, 1500);
    }
};

window.updateSamplerProgress = function() {
    const count = window.customInstrumentBuffers ? Object.keys(window.customInstrumentBuffers).length : 0;
    const progressEl = document.getElementById('samplerProgressText');
    if (progressEl) progressEl.innerText = `Campioni caricati: ${count} / 30`;
    
    // Aggiorna lo stato visivo di riproduzione per la nota corrente
    if (typeof window.currentSelectedSamplerNote !== 'undefined' && window.currentSelectedSamplerNote) {
        const name = window.currentSelectedSamplerNote.name;
        const playbackRow = document.getElementById('samplerPlaybackRow');
        if (playbackRow) {
            if (window.customInstrumentBuffers && window.customInstrumentBuffers[name]) {
                playbackRow.style.display = 'flex';
            } else {
                playbackRow.style.display = 'none';
            }
        }
    }

    // Ricolora le note a seconda che siano registrate o no
    for (let m of window.activeMidi30) {
        const name = window.noteNames30[window.activeMidi30.indexOf(m)];
        const keyEl = document.getElementById(`s-key-${m}`);
        const isBlack = [1,3,6,8,10].includes(m % 12);
        
        if (keyEl) {
            if (window.customInstrumentBuffers && window.customInstrumentBuffers[name]) {
                keyEl.style.background = "#50fa7b"; // Verde brillante per campioni salvati
            } else {
                // Ritorna al colore standard se non registrato
                keyEl.style.background = isBlack ? "#111111" : "#ffffff";
            }
        }
    }
};

// ==========================================
// 3. MOTORE GRAFICO (SYNTHESIA + SPARTITO)
// ==========================================
window.initSynthesiaCanvas = function() {
    synthCanvas = document.getElementById('synthesiaCanvas'); if (!synthCanvas) return;
    synthCtx = synthCanvas.getContext('2d');
    const resize = () => { synthCanvas.width = synthCanvas.clientWidth; synthCanvas.height = synthCanvas.clientHeight; };
    window.addEventListener('resize', resize); setTimeout(resize, 100);
    
    const notesMap = [ { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: true }, { isBlack: false } ];
    let totalWhiteKeys = 0; const whiteKeyIndices = {};
    for (let m = window.startMidi; m <= window.endMidi; m++) if (!notesMap[m % 12].isBlack) whiteKeyIndices[m] = totalWhiteKeys++;
    for (let m = window.startMidi; m <= window.endMidi; m++) {
        if (!notesMap[m % 12].isBlack) canvasMap[m] = { xPct: whiteKeyIndices[m] / totalWhiteKeys, wPct: 1 / totalWhiteKeys, isBlack: false };
        else canvasMap[m] = { leftPct: (whiteKeyIndices[m - 1] + 1) / totalWhiteKeys, isBlack: true };
    }
};

window.initStaffCanvas = function() {
    staffCanvas = document.getElementById('staffCanvas'); if (!staffCanvas) return;
    staffCtx = staffCanvas.getContext('2d');
    const resize = () => { staffCanvas.width = staffCanvas.clientWidth; staffCanvas.height = staffCanvas.clientHeight; window.renderScrollingStaff(0); };
    window.addEventListener('resize', resize); setTimeout(resize, 100);
};

window.renderSynthesia = function(now, elapsed) {
    if (!synthCtx || !synthCanvas) return;
    synthCtx.clearRect(0, 0, synthCanvas.width, synthCanvas.height);

    if (isPlaying) {
        synthCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        synthCtx.lineWidth = 1;
        for (let m = window.startMidi; m <= window.endMidi; m++) {
            if (m % 12 === 0) { 
                const map = canvasMap[m];
                if (map && !map.isBlack) {
                    const x = map.xPct * synthCanvas.width;
                    synthCtx.beginPath(); synthCtx.moveTo(x, 0); synthCtx.lineTo(x, synthCanvas.height); synthCtx.stroke();
                }
            }
        }
    }
    
    if (!isPlaying || !window.visualTimeline) return;

    const bpm = parseFloat(document.getElementById('bpmSlider').value);
    const beatDuration = 60 / bpm;

    window.visualTimeline.forEach(note => {
        const noteStartSec = note.beat * beatDuration;
        const noteEndSec = (note.beat + note.durationBeats) * beatDuration;
        if (noteEndSec < elapsed || noteStartSec > elapsed + lookaheadSec) return;

        const map = canvasMap[note.midi]; if (!map) return;
        let yBottom = synthCanvas.height - ((noteStartSec - elapsed) / lookaheadSec) * synthCanvas.height;
        let yTop = synthCanvas.height - ((noteEndSec - elapsed) / lookaheadSec) * synthCanvas.height;
        let h = Math.max(yBottom - yTop, 4); 
        let y = yTop;

        synthCtx.fillStyle = note.type === 'chord' ? '#a78bfa' : '#34d399';
        let w = map.isBlack ? 0.0115 * synthCanvas.width : map.wPct * synthCanvas.width; 
        let x = map.isBlack ? map.leftPct * synthCanvas.width - (w / 2) : map.xPct * synthCanvas.width;
        let r = Math.min(w / 2, 4);

        synthCtx.beginPath();
        synthCtx.roundRect(x + 0.5, y, w - 1, h, r);
        synthCtx.fill();
    });
};

window.renderScrollingStaff = function(currentBeat) {
    if (!staffCanvas || !staffCtx) return;
    const ctx = staffCtx; const w = staffCanvas.width; const h = staffCanvas.height;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
    const gap = 14; const centerY_treble = h * 0.26; const centerY_bass = h * 0.74;   
    const playLineX = w / 2; const pixelsPerBeat = 60;        

    ctx.strokeStyle = "#cccccc"; ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(0, centerY_treble + i * gap); ctx.lineTo(w, centerY_treble + i * gap); ctx.stroke(); }
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(0, centerY_bass + i * gap); ctx.lineTo(w, centerY_bass + i * gap); ctx.stroke(); }

    let beatsPerMeasure = 4;
    if (window.loadedSong && window.loadedSong.meter) { const match = window.loadedSong.meter.match(/^(\d+)\//); if (match) beatsPerMeasure = parseInt(match[1], 10); }

    const startMeasure = Math.floor((currentBeat - (playLineX / pixelsPerBeat)) / beatsPerMeasure);
    const endMeasure = Math.ceil((currentBeat + ((w - playLineX) / pixelsPerBeat)) / beatsPerMeasure);

    ctx.strokeStyle = "#bbbbbb"; ctx.lineWidth = 1.5;
    for (let m = Math.max(0, startMeasure); m <= endMeasure; m++) {
        const measureBeat = m * beatsPerMeasure; const mx = playLineX + (measureBeat - currentBeat) * pixelsPerBeat;
        if (mx >= 85 && mx <= w) {
            ctx.beginPath(); ctx.moveTo(mx, centerY_treble - 2 * gap); ctx.lineTo(mx, centerY_bass + 2 * gap); ctx.stroke();
            ctx.fillStyle = "#888888"; ctx.font = "italic bold 13px sans-serif"; ctx.fillText((m + 1).toString(), mx + 6, centerY_treble - 2.5 * gap);
        }
    }

    if (currentTrebleNotes.length > 0) {
        currentTrebleNotes.forEach(note => {
            const x = playLineX + (note.beat - currentBeat) * pixelsPerBeat;
            if (x < 85 || x > w + 100) return; 
            let displayMidi = note.note > 83 ? note.note - 12 : note.note;
            const step = window.midiToDiatonicStep(displayMidi); const y = centerY_treble - (step - 38) * (gap / 2);
            drawNoteOnCanvas(ctx, x, y, step, note.duration, pixelsPerBeat, gap, centerY_treble, true, note.note > 83, false);
        });
    }

    if (currentBassNotes.length > 0) {
        currentBassNotes.forEach(note => {
            const x = playLineX + (note.beat - currentBeat) * pixelsPerBeat;
            if (x < 85 || x > w + 100) return;
            let displayMidi = note.note < 36 ? note.note + 12 : note.note;
            const step = window.midiToDiatonicStep(displayMidi); const y = centerY_bass - (step - 26) * (gap / 2);
            drawNoteOnCanvas(ctx, x, y, step, note.duration, pixelsPerBeat, gap, centerY_bass, false, false, note.note < 36);
        });
    }

    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 85, h);
    ctx.strokeStyle = "#bbbbbb"; ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(0, centerY_treble + i * gap); ctx.lineTo(85, centerY_treble + i * gap); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, centerY_bass + i * gap); ctx.lineTo(85, centerY_bass + i * gap); ctx.stroke();
    }

    ctx.strokeStyle = "#111111"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(15, centerY_treble - 2 * gap); ctx.lineTo(15, centerY_bass + 2 * gap); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(15, centerY_treble - 2 * gap); ctx.lineTo(23, centerY_treble - 2 * gap); ctx.moveTo(15, centerY_bass + 2 * gap); ctx.lineTo(23, centerY_bass + 2 * gap); ctx.stroke();
    ctx.fillStyle = "#111111"; ctx.font = "72px serif"; ctx.fillText("𝄞", 20, centerY_treble + 25); ctx.fillText("𝄢", 20, centerY_bass + 20);

    ctx.strokeStyle = "red"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(playLineX, 15); ctx.lineTo(playLineX, h - 15); ctx.stroke();
};

function drawNoteOnCanvas(ctx, x, y, step, duration, pixelsPerBeat, gap, centerY, isTreble, is8va, is8vb) {
    if (duration > 0) { const trailWidth = duration * pixelsPerBeat; ctx.fillStyle = "rgba(0, 0, 0, 0.05)"; ctx.fillRect(x, y - 3, trailWidth, 6); }
    ctx.strokeStyle = "#444444"; ctx.lineWidth = 1.0;          
    ctx.save(); ctx.translate(x, y); ctx.rotate(-20 * Math.PI / 180); ctx.fillStyle = "#000000"; ctx.beginPath(); ctx.ellipse(0, 0, 9, 6, 0, 0, 2 * Math.PI); ctx.fill(); ctx.restore();
    const stemUp = isTreble ? (y > centerY) : (y > centerY); ctx.strokeStyle = "#000000"; ctx.lineWidth = 2.2;         
    ctx.beginPath(); ctx.moveTo(stemUp ? x + 6 : x - 6, y); ctx.lineTo(stemUp ? x + 6 : x - 6, stemUp ? y - 38 : y + 38); ctx.stroke();
    if (is8va || is8vb) { ctx.fillStyle = "#ff5555"; ctx.font = "italic bold 12px sans-serif"; ctx.fillText(is8va ? "8va" : "8vb", x - 10, is8va ? y - 14 : y + 18); }
}

// ==========================================
// 4. GESTIONE PLAYBACK E SINCRONIZZAZIONE
// ==========================================
window.importSongFromJSON = function(songData) {
    window.stopPlayback(false); 
    const bpm = songData.bpm || 105;
    document.getElementById('bpmSlider').value = bpm; document.getElementById('bpmVal').innerText = bpm;

    currentTrebleNotes = songData.right_hand || songData.melody || [];
    currentBassNotes = songData.left_hand || [];
    
    if (songData.chords && currentBassNotes.length === 0) {
        let currBeat = 0;
        songData.chords.forEach(chord => {
            chord.notes.forEach(n => currentBassNotes.push({ note: n, beat: currBeat, duration: chord.beats }));
            currBeat += chord.beats;
        });
    }

    playbackTimeline = []; let maxBeat = 0;
    currentTrebleNotes.forEach(item => { playbackTimeline.push({ beat: item.beat, midi: item.note, durationBeats: item.duration, type: 'melody', volume: item.velocity ? item.velocity/127 : 0.8 }); if (item.beat + item.duration > maxBeat) maxBeat = item.beat + item.duration; });
    currentBassNotes.forEach(item => { playbackTimeline.push({ beat: item.beat, midi: item.note, durationBeats: item.duration, type: 'chord', volume: item.velocity ? item.velocity/127 : 0.7 }); if (item.beat + item.duration > maxBeat) maxBeat = item.beat + item.duration; });
    playbackTimeline.sort((a, b) => a.beat - b.beat);
    window.visualTimeline = JSON.parse(JSON.stringify(playbackTimeline));
    totalDurationSec = (maxBeat * (60 / bpm)) + 2.0; 

    // Aggiorna lo spartito istantaneamente
    window.renderScrollingStaff(0);
};

window.playComposition = function(userInitiated = true) {
    if (userInitiated !== false) window.isPlaylistMode = false;
    
    // Controlla che i buffer piano siano caricati
    if (typeof pianoBuffers !== 'undefined' && Object.keys(pianoBuffers).length === 0) {
        return alert("Attendi un istante, strumento in caricamento! 🎹");
    }
    
    window.stopPlayback(false); 
    window.importSongFromJSON(window.loadedSong);
    
    const btn = document.getElementById('mainPlayBtn');
    if (btn) { btn.innerHTML = '⏸️ PAUSA'; btn.classList.add('playing'); }

    playStartTime = audioCtx.currentTime + 0.10; isPlaying = true; lastScheduledBeat = 0; scheduledNotes = []; 
    schedulerWorker.postMessage('start');
    requestAnimationFrame(animateProgress);
};

function animateProgress() {
    if (!isPlaying || !audioCtx) return;
    const now = audioCtx.currentTime; const elapsed = now - playStartTime;
    
    window.renderSynthesia(now, elapsed);

    const bpm = parseFloat(document.getElementById('bpmSlider').value);
    window.renderScrollingStaff(Math.max(0, (elapsed - 0.08) / (60 / bpm)));

    if (elapsed >= totalDurationSec) { 
        window.stopPlayback(false); 
        if (window.isPlaylistMode && window.playNextInPlaylist) {
            setTimeout(() => window.playNextInPlaylist(), 1000);
        }
        return; 
    }
    
    const bar = document.getElementById('progressBar');
    if (bar) bar.style.width = `${(elapsed / totalDurationSec) * 100}%`;
    
    const activeNotes = scheduledNotes.filter(n => now >= n.start && now < n.end);
    document.querySelectorAll('#keyboard .key-white, #keyboard .key-black').forEach(k => {
        if(!k.classList.contains('manual-active')) {
            const midi = parseInt(k.dataset.midi);
            const activeNote = activeNotes.find(n => n.midi === midi);
            k.classList.remove('active-chord', 'active-melody');
            if (activeNote) k.classList.add(activeNote.type === 'chord' ? 'active-chord' : 'active-melody');
        }
    });
    
    progressAnimationId = requestAnimationFrame(animateProgress);
}

window.stopPlayback = function(userInitiated = true) {
    if (userInitiated !== false) window.isPlaylistMode = false;
    
    const btn = document.getElementById('mainPlayBtn');
    if (btn) { btn.innerHTML = '▶️ PLAY'; btn.classList.remove('playing'); }

    if (typeof activeNodes !== 'undefined') {
        activeNodes.forEach(node => { try { node.stop(); } catch(e){} });
        activeNodes = []; 
    }
    scheduledNotes = []; isPlaying = false; 
    
    if (schedulerWorker) schedulerWorker.postMessage('stop');
    if (typeof progressAnimationId !== 'undefined') cancelAnimationFrame(progressAnimationId);
    
    const bar = document.getElementById('progressBar');
    if (bar) bar.style.width = '0%';
    
    document.querySelectorAll('#keyboard .key-white, #keyboard .key-black').forEach(k => k.classList.remove('active-chord', 'active-melody'));
    
    // Ripristina grafiche a zero
    window.renderSynthesia(0, 0);
    window.renderScrollingStaff(0);
};

window.updateBPM = function(val) { 
    const el = document.getElementById('bpmVal');
    if (el) el.innerText = val; 
};

// ==========================================
// END OF FILE ui.js
// ==========================================