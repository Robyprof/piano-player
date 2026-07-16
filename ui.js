// START OF FILE ui.js
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

            const pressKey = async (e) => { e.preventDefault(); if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); keyDiv.classList.add('active-key', 'manual-active'); window.playSampledNote(m, audioCtx ? audioCtx.currentTime : 0, 1.5, 1.2, 'manual'); };
            const releaseKey = (e) => { e.preventDefault(); keyDiv.classList.remove('active-key', 'manual-active'); };
            keyDiv.addEventListener('mousedown', pressKey); keyDiv.addEventListener('touchstart', pressKey);
            keyDiv.addEventListener('mouseup', releaseKey); keyDiv.addEventListener('mouseleave', releaseKey); keyDiv.addEventListener('touchend', releaseKey);
        }
    }
};

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

window.renderSynthesia = function(now, elapsed) {
    if (!synthCtx || !synthCanvas) return;
    synthCtx.clearRect(0, 0, synthCanvas.width, synthCanvas.height);

    if (isPlaying) {
        const bpm = parseFloat(document.getElementById('bpmSlider').value);
        const beatDuration = 60 / bpm;
        
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
};

window.playComposition = function(userInitiated = true) {
    if (userInitiated !== false) window.isPlaylistMode = false;
    if (Object.keys(pianoBuffers).length === 0) return alert("Attendi un istante, strumento in caricamento! 🎹");
    
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

    if (elapsed >= totalDurationSec) { 
        window.stopPlayback(false); 
        if (window.isPlaylistMode && window.playNextInPlaylist) {
            setTimeout(() => window.playNextInPlaylist(), 1000);
        }
        return; 
    }
    document.getElementById('progressBar').style.width = `${(elapsed / totalDurationSec) * 100}%`;
    
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

    activeNodes.forEach(node => { try { node.stop(); } catch(e){} });
    activeNodes = []; scheduledNotes = []; isPlaying = false; 
    if (schedulerWorker) schedulerWorker.postMessage('stop');
    cancelAnimationFrame(progressAnimationId);
    document.getElementById('progressBar').style.width = '0%';
    document.querySelectorAll('#keyboard .key-white, #keyboard .key-black').forEach(k => k.classList.remove('active-chord', 'active-melody'));
    window.renderSynthesia(0, 0);
};

window.updateBPM = function(val) { document.getElementById('bpmVal').innerText = val; };