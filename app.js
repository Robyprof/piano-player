// [HOOK: CONFIG]
window.FIREBASE_DB_URL = "https://piano-jazz-c1ed3-default-rtdb.europe-west1.firebasedatabase.app"; 
window.loadedSong = null; 
window.firebaseDatabase = null;
window.startMidi = 21;
window.endMidi = 108;
window.noteNames30 = ["A0","C1","Ds1","Fs1","A1","C2","Ds2","Fs2","A2","C3","Ds3","Fs3","A3","C4","Ds4","Fs4","A4","C5","Ds5","Fs5","A5","C6","Ds6","Fs6","A6","C7","Ds7","Fs7","A7","C8"];
window.activeMidi30 = [21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84, 87, 90, 93, 96, 99, 102, 105, 108];

// [HOOK: TAB_LOGIC]
window.switchTab = function(tabId, btn) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    btn.classList.add('active');

    if (tabId === 'tab-play') {
        window.dispatchEvent(new Event('resize')); // Fix Canvas Rendering
    }
};

// [HOOK: INIT]
window.addEventListener('DOMContentLoaded', () => {
    if (window.initSchedulerWorker) window.initSchedulerWorker();
    if (window.buildMainKeyboard) window.buildMainKeyboard();
    if (window.initSynthesiaCanvas) window.initSynthesiaCanvas();
    if (window.initStaffCanvas) window.initStaffCanvas();
    if (window.loadAudioSourcesFromFirebase) window.loadAudioSourcesFromFirebase();
    if (window.loadSongsListFromFirebase) window.loadSongsListFromFirebase();

    const jsonLoader = document.getElementById('jsonLoader');
    if (jsonLoader) {
        jsonLoader.addEventListener('change', e => {
            const file = e.target.files[0]; if (!file) return;
            
            // Popola i campi input del salvataggio Firebase automaticamente
            let cleanName = file.name.replace('.json','').replace(/[^a-zA-Z0-9_]/g, "_");
            document.getElementById('saveSongInput').value = cleanName;

            const reader = new FileReader();
            reader.onload = evt => {
                try { 
                    window.isPlaylistMode = false; // Ferma la riproduzione automatica in caso di upload manuale
                    window.loadedSong = JSON.parse(evt.target.result);
                    window.importSongFromJSON(window.loadedSong);
                    alert("File Locale Caricato! Vai su 'Suona Spartito' per vederlo, o archivialo nel Cloud tramite il riquadro sottostante.");
                } catch (err) { alert("Errore nel file: " + err.message); }
            }; 
            reader.readAsText(file);
        });
    }
});

// [HOOK: PLAYLIST_LOGIC]
window.isPlaylistMode = false;
window.playlistAuthor = null;
window.playlistSongKeys = [];
window.playlistIndex = 0;

window.startAuthorPlaylist = async function() {
    if (typeof audioCtx !== 'undefined' && audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    
    const authorKey = document.getElementById('authorSelect').value;
    if (!authorKey || !window.firebaseDatabase[authorKey]) return alert("Seleziona una raccolta!");
    
    const songKeys = Object.keys(window.firebaseDatabase[authorKey]).filter(k => k !== '_authorNotes');
    if (songKeys.length === 0) return alert("La raccolta è vuota!");

    window.isPlaylistMode = true;
    window.playlistAuthor = authorKey;
    window.playlistSongKeys = songKeys;
    window.playlistIndex = 0;
    
    // Passa alla tab Play (indice 2)
    const tabs = document.querySelectorAll('.tab-btn');
    if (tabs.length > 2) window.switchTab('tab-play', tabs[2]);

    await window.loadAndPlayPlaylistSong();
};

window.loadAndPlayPlaylistSong = async function() {
    if (!window.isPlaylistMode) return;
    
    const authorKey = window.playlistAuthor;
    const songKey = window.playlistSongKeys[window.playlistIndex];
    
    document.getElementById('authorSelect').value = authorKey;
    if (window.onAuthorSelected) window.onAuthorSelected(authorKey, true);
    document.getElementById('songSelect').value = songKey;

    try {
        const response = await fetch(`${window.FIREBASE_DB_URL}/scores/${authorKey}/${songKey}.json`);
        const songData = await response.json();
        if (songData) {
            window.loadedSong = songData;
            window.importSongFromJSON(songData);
            
            const songPanel = document.getElementById('songActionsPanel');
            const notesArea = document.getElementById('songNotesArea');
            if (songPanel) songPanel.style.display = 'block';
            if (notesArea) notesArea.value = songData.notes || "";

            setTimeout(() => { 
                if (window.isPlaylistMode && window.playComposition) window.playComposition(false); 
            }, 500);
        } else {
            window.playNextInPlaylist();
        }
    } catch(e) { 
        console.error("Errore nel caricamento del brano della playlist:", e); 
        window.playNextInPlaylist(); 
    }
};

window.playNextInPlaylist = function() {
    if (!window.isPlaylistMode) return;
    window.playlistIndex++;
    if (window.playlistIndex >= window.playlistSongKeys.length) {
        window.playlistIndex = 0; // Riproduzione in Loop Continuo
    }
    window.loadAndPlayPlaylistSong();
};