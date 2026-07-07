// [HOOK: UI_GLOBALS]
let synthCanvas, synthCtx, canvasMap = {};
let staffCanvas, staffCtx;
const lookaheadSec = 3.0;
let currentTrebleNotes = [], currentBassNotes = [];

// [HOOK: KEYBOARDS_RENDER]
window.buildMainKeyboard = function() {
    const keyboard = document.getElementById('keyboard');
    const notesMap = [ { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: true }, { isBlack: false } ];
    let totalWhiteKeys = 0; const whiteKeyIndices = {};
    for (let m = window.startMidi; m <= window.endMidi; m++) if (!notesMap[m % 12].isBlack) whiteKeyIndices[m] = totalWhiteKeys++;

    if (keyboard) {
        keyboard.innerHTML = `<div class="white-keys-container" id="whiteKeys"></div><div class="black-keys-container" id="blackKeys" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;"></div>`;
        for (let m = window.startMidi; m <= window.endMidi; m++) {
            const isBlack = notesMap[m % 12].isBlack;
            let keyDiv = document.createElement('div'); keyDiv.dataset.midi = m;
            if (!isBlack) { keyDiv.className = 'key-white'; document.getElementById('whiteKeys').appendChild(keyDiv); } 
            else { keyDiv.className = 'key-black'; keyDiv.style.left = `${((whiteKeyIndices[m - 1] + 1) / totalWhiteKeys) * 100}%`; keyDiv.style.transform = 'translateX(-50%)'; keyDiv.style.pointerEvents = 'auto'; document.getElementById('blackKeys').appendChild(keyDiv); }

            const pressKey = async (e) => { e.preventDefault(); if (!audioCtx) return; if (audioCtx.state === 'suspended') audioCtx.resume(); keyDiv.classList.add('active-key', 'manual-active'); window.playSampledNote(m, audioCtx.currentTime, 1.5, 1.2, 'manual'); };
            const releaseKey = (e) => { e.preventDefault(); keyDiv.classList.remove('active-key', 'manual-active'); };
            keyDiv.addEventListener('mousedown', pressKey); keyDiv.addEventListener('touchstart', pressKey);
            keyDiv.addEventListener('mouseup', releaseKey); keyDiv.addEventListener('mouseleave', releaseKey); keyDiv.addEventListener('touchend', releaseKey);
        }
    }
};

window.renderSamplerKeyboard = function() {
    const kb = document.getElementById('samplerKeyboardGen');
    kb.innerHTML = '';
    const notesMap = [ { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: true }, { isBlack: false } ];
    let totalWhiteKeys = 0; const whiteKeyIndices = {};
    for (let m = window.startMidi; m <= window.endMidi; m++) if (!notesMap[m % 12].isBlack) whiteKeyIndices[m] = totalWhiteKeys++;

    const whiteContainer = document.createElement('div'); whiteContainer.className = 'sampler-white-keys';
    const blackContainer = document.createElement('div'); blackContainer.className = 'sampler-black-keys';

    for (let m = window.startMidi; m <= window.endMidi; m++) {
        const isBlack = notesMap[m % 12].isBlack;
        const isActive30 = window.activeMidi30.includes(m);
        const noteName = isActive30 ? window.noteNames30[window.activeMidi30.indexOf(m)] : '';

        let keyDiv = document.createElement('div'); keyDiv.id = `s-key-${m}`;
        
        if (!isBlack) {
            keyDiv.className = `s-key-white ${isActive30 ? 's-active' : 's-inactive'}`;
            if (isActive30) keyDiv.innerHTML = `<span class="s-label">${noteName}</span>`;
            whiteContainer.appendChild(keyDiv);
        } else {
            keyDiv.className = `s-key-black ${isActive30 ? 's-active' : 's-inactive'}`;
            keyDiv.style.left = `${((whiteKeyIndices[m - 1] + 1) / totalWhiteKeys) * 100}%`; keyDiv.style.transform = 'translateX(-50%)';
            if (isActive30) keyDiv.innerHTML = `<span class="s-label">${noteName}</span>`;
            blackContainer.appendChild(keyDiv);
        }

        if (isActive30) {
            keyDiv.onmousedown = () => window.selectSamplerNote(m, noteName);
            keyDiv.ontouchstart = (e) => { e.preventDefault(); window.selectSamplerNote(m, noteName); };
        }
    }
    kb.appendChild(whiteContainer); kb.appendChild(blackContainer);
};

// [HOOK: SAMPLER_MODAL_UI]
window.openSamplerModal = function() {
    document.getElementById('samplerModal').style.display = 'flex';
    window.renderSamplerKeyboard(); window.updateSamplerProgress();
    document.getElementById('samplerActionPanel').style.display = 'none';
};
window.closeSamplerModal = function() { document.getElementById('samplerModal').style.display = 'none'; if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop(); };

window.selectSamplerNote = function(midi, name) {
    if (currentSelectedSamplerNote) {
        const oldKey = document.getElementById(`s-key-${currentSelectedSamplerNote.midi}`);
        if (oldKey) oldKey.classList.remove('s-selected');
    }
    currentSelectedSamplerNote = { midi, name };
    const newKey = document.getElementById(`s-key-${midi}`);
    if (newKey) newKey.classList.add('s-selected');

    document.getElementById('samplerSelectedNoteLabel').innerText = `Registrazione: ${name}`;
    document.getElementById('samplerActionPanel').style.display = 'block';

    const btn = document.getElementById('btn-rec-modal');
    if (mediaRecorder && mediaRecorder.state === 'recording') { mediaRecorder.stop(); clearTimeout(recordingTimeout); }
    btn.classList.remove('recording-pulse'); btn.innerText = "🎤 Registra Microfono";
};

window.updateSamplerProgress = function() {
    const count = Object.keys(window.customInstrumentBuffers).length;
    document.getElementById('samplerProgressText').innerText = `Campioni caricati: ${count} / 30`;
    for (let m of window.activeMidi30) {
        const name = window.noteNames30[window.activeMidi30.indexOf(m)];
        const keyEl = document.getElementById(`s-key-${m}`);
        if (keyEl) window.customInstrumentBuffers[name] ? keyEl.classList.add('s-recorded') : keyEl.classList.remove('s-recorded');
    }
};

// [HOOK: SYNTHESIA_RENDER]
window.initSynthesiaCanvas = function() {
    synthCanvas = document.getElementById('synthesiaCanvas'); if (!synthCanvas) return;
    synthCtx = synthCanvas.getContext('2d');
    const resize = () => { synthCanvas.width = synthCanvas.clientWidth; synthCanvas.height = synthCanvas.clientHeight; };
    window.addEventListener('resize', resize); resize();
    
    const notesMap = [ { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: true }, { isBlack: false }, { isBlack: true }, { isBlack: false } ];
    let totalWhiteKeys = 0; const whiteKeyIndices = {};
    for (let m = window.startMidi; m <= window.endMidi; m++) if (!notesMap[m % 12].isBlack) whiteKeyIndices[m] = totalWhiteKeys++;
    for (let m = window.startMidi; m <= window.endMidi; m++) {
        if (!notesMap[m % 12].isBlack) canvasMap[m] = { xPct: whiteKeyIndices[m] / totalWhiteKeys, wPct: 1 / totalWhiteKeys, isBlack: false };
        else canvasMap[m] = { leftPct: (whiteKeyIndices[m - 1] + 1) / totalWhiteKeys, isBlack: true };
    }
};

window.renderSynthesia = function(now, elapsed) {
    if (!synthCtx || !synthCanvas) return;
    synthCtx.fillStyle = '#444444'; synthCtx.fillRect(0, 0, synthCanvas.width, synthCanvas.height);
    if (!isPlaying || !scheduledNotes) return;

    scheduledNotes.forEach(note => {
        if (note.end < now || note.start > now + lookaheadSec) return; 
        const map = canvasMap[note.midi]; if (!map) return;
        let yBottom = synthCanvas.height - ((note.start - now) / lookaheadSec) * synthCanvas.height;
        let yTop = synthCanvas.height - ((note.end - now) / lookaheadSec) * synthCanvas.height;
        const h = Math.max(yBottom - yTop, 2);

        synthCtx.fillStyle = note.type === 'chord' ? '#d97a35' : '#3a6fb0';
        synthCtx.strokeStyle = '#111'; synthCtx.lineWidth = 1;

        if (map.isBlack) {
            const w = 0.0115 * synthCanvas.width; const x = map.leftPct * synthCanvas.width - (w / 2);
            synthCtx.fillRect(x, yTop, w, h); synthCtx.strokeRect(x, yTop, w, h);
        } else {
            const w = map.wPct * synthCanvas.width; const x = map.xPct * synthCanvas.width;
            synthCtx.fillRect(x + 0.5, yTop, w - 1, h); synthCtx.strokeRect(x + 0.5, yTop, w - 1, h);
        }
    });
};

// [HOOK: STAFF_RENDER]
function midiToDiatonicStep(midi) { const octave = Math.floor(midi / 12) - 1; const noteClass = midi % 12; const cMajOffsets = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]; return octave * 7 + cMajOffsets[noteClass]; }
window.initStaffCanvas = function() {
    staffCanvas = document.getElementById('staffCanvas'); if (!staffCanvas) return;
    staffCtx = staffCanvas.getContext('2d');
    const resize = () => { staffCanvas.width = staffCanvas.clientWidth; staffCanvas.height = staffCanvas.clientHeight; window.renderScrollingStaff(0); };
    window.addEventListener('resize', resize); resize();
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
            const step = midiToDiatonicStep(displayMidi); const y = centerY_treble - (step - 38) * (gap / 2);
            drawNoteOnCanvas(ctx, x, y, step, note.duration, pixelsPerBeat, gap, centerY_treble, true, note.note > 83, false);
        });
    }

    if (currentBassNotes.length > 0) {
        currentBassNotes.forEach(note => {
            const x = playLineX + (note.beat - currentBeat) * pixelsPerBeat;
            if (x < 85 || x > w + 100) return;
            let displayMidi = note.note < 36 ? note.note + 12 : note.note;
            const step = midiToDiatonicStep(displayMidi); const y = centerY_bass - (step - 26) * (gap / 2);
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

// [HOOK: PLAYBACK_AND_ANIMATION]
window.importSongFromJSON = function(songData) {
    window.stopPlayback(); 
    document.getElementById('stdName').innerText = songData.name || "Brano Caricato";
    document.getElementById('stdSub').innerText = songData.sub || "La tastiera reale a 88 tasti è attiva.";
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
    totalDurationSec = (maxBeat * (60 / bpm)) + 2.0; 
    window.renderScrollingStaff(0);
};

window.playComposition = async function() {
    if (!audioCtx || Object.keys(pianoBuffers).length === 0) return alert("Attendi il caricamento dello strumento!");
    if (audioCtx.state === 'suspended') audioCtx.resume(); window.stopPlayback(); 
    if (!window.loadedSong) return alert("Carica uno spartito prima di premere Play!");

    window.importSongFromJSON(window.loadedSong);
    playStartTime = audioCtx.currentTime + 0.50; isPlaying = true; lastScheduledBeat = 0; scheduledNotes = []; 
    document.getElementById('progressContainer').style.display = 'block';
    
    schedulerWorker.postMessage('start');
    requestAnimationFrame(animateProgress);
};

function animateProgress() {
    if (!isPlaying || !audioCtx) return;
    const now = audioCtx.currentTime; const elapsed = now - playStartTime;
    window.renderSynthesia(now, elapsed);

    const bpm = parseFloat(document.getElementById('bpmSlider').value);
    window.renderScrollingStaff(Math.max(0, (elapsed - 0.08) / (60 / bpm)));

    if (elapsed >= totalDurationSec) { window.stopPlayback(); return; }
    document.getElementById('progressBar').style.width = `${(elapsed / totalDurationSec) * 100}%`;
    
    const activeMidiNotes = scheduledNotes.filter(n => now >= n.start && now < n.end).map(n => n.midi);
    document.querySelectorAll('#keyboard .key-white, #keyboard .key-black').forEach(k => {
        if(!k.classList.contains('manual-active')) k.classList.toggle('active-key', activeMidiNotes.includes(parseInt(k.dataset.midi)));
    });
    progressAnimationId = requestAnimationFrame(animateProgress);
}

window.stopPlayback = function() {
    activeNodes.forEach(node => { try { node.stop(); } catch(e){} });
    activeNodes = []; scheduledNotes = []; isPlaying = false; 
    if (schedulerWorker) schedulerWorker.postMessage('stop');
    cancelAnimationFrame(progressAnimationId);
    document.getElementById('progressBar').style.width = '0%'; document.getElementById('progressContainer').style.display = 'none';
    document.querySelectorAll('#keyboard .key-white, #keyboard .key-black').forEach(k => k.classList.remove('active-key'));
    window.renderScrollingStaff(0); window.renderSynthesia(0, 0);
};

window.updateBPM = function(val) { document.getElementById('bpmVal').innerText = val; if (!isPlaying) window.renderScrollingStaff(0); };