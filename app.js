// [HOOK: CONFIG]
window.FIREBASE_DB_URL = "https://piano-jazz-c1ed3-default-rtdb.europe-west1.firebasedatabase.app"; 
window.loadedSong = null; 
window.firebaseDatabase = null;
window.startMidi = 21;
window.endMidi = 108;
window.noteNames30 = ["A0","C1","Ds1","Fs1","A1","C2","Ds2","Fs2","A2","C3","Ds3","Fs3","A3","C4","Ds4","Fs4","A4","C5","Ds5","Fs5","A5","C6","Ds6","Fs6","A6","C7","Ds7","Fs7","A7","C8"];
window.activeMidi30 = [21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84, 87, 90, 93, 96, 99, 102, 105, 108];
window.isPlaylistMode = true; // Auto Playlist abilitata di default
window.playlistAuthor = null;
window.playlistSongKeys = [];
window.playlistIndex = 0;

// [HOOK: INIT - AVVIO AUTOMATICO DELL'INTERO AMBIENTE]
window.addEventListener('DOMContentLoaded', async () => {
    // 1. Inizializza i Layer Visivi in Backgrond
    if (window.initSchedulerWorker) window.initSchedulerWorker();
    if (window.buildMainKeyboard) window.buildMainKeyboard();
    if (window.initSynthesiaCanvas) window.initSynthesiaCanvas();
    if (window.initStaffCanvas) window.initStaffCanvas();
    
    // 2. Avvia SILENZIOSAMENTE il download dello strumento (stato suspended)
    if (window.loadAudioSourcesFromFirebase) window.loadAudioSourcesFromFirebase();
    if (window.initAudioEngine) window.initAudioEngine();

    // 3. Pesca una Raccolta Casuale dal Cloud e la Pre-Carica
    if (window.loadSongsListFromFirebase) {
        await window.loadSongsListFromFirebase();
        if (window.firebaseDatabase) {
            const authors = Object.keys(window.firebaseDatabase).filter(k => k !== '_authorNotes' && typeof window.firebaseDatabase[k] === 'object');
            if (authors.length > 0) {
                const randomAuthor = authors[Math.floor(Math.random() * authors.length)];
                document.getElementById('authorSelect').value = randomAuthor;
                window.onAuthorSelected(randomAuthor, true);

                window.playlistAuthor = randomAuthor;
                window.playlistSongKeys = Object.keys(window.firebaseDatabase[randomAuthor]).filter(k => k !== '_authorNotes');
                window.playlistIndex = 0;

                // Pre-carica il JSON del primo brano senza attivare l'audio
                if (window.playlistSongKeys.length > 0) {
                    await window.preloadFirstSong(randomAuthor, window.playlistSongKeys[0]);
                }
            }
        }
    }

    // Loader File Locale
    const jsonLoader = document.getElementById('jsonLoader');
    if (jsonLoader) {
        jsonLoader.addEventListener('change', e => {
            const file = e.target.files[0]; if (!file) return;
            let cleanName = file.name.replace('.json','').replace(/[^a-zA-Z0-9_]/g, "_");
            document.getElementById('saveSongInput').value = cleanName;
            const reader = new FileReader();
            reader.onload = evt => {
                try { 
                    window.isPlaylistMode = false;
                    window.loadedSong = JSON.parse(evt.target.result);
                    window.importSongFromJSON(window.loadedSong);
                    document.getElementById('nowPlayingTitle').innerText = window.loadedSong.name || cleanName;
                    document.getElementById('nowPlayingAuthor').innerText = "BRANO LOCALE";
                } catch (err) { alert("Errore nel file: " + err.message); }
            }; 
            reader.readAsText(file);
        });
    }
});

// [HOOK: MAIN_PLAY_TOGGLE - IL COMANDO CENTRALE]
window.toggleMainPlay = async function() {
    // Risveglia il motore audio dal blocco policy dei browser
    if (!audioCtx) await window.initAudioEngine();
    if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();

    if (!window.loadedSong) {
        alert("Attendi un istante il caricamento del brano dal Cloud...");
        return;
    }

    if (isPlaying) {
        window.pausePlayback(); // Mette in pausa invece di fermare
    } else {
        // Riprende dal punto in cui era stato messo in pausa
        window.playComposition(true, window.currentPauseTime || 0);
    }
};

window.preloadFirstSong = async function(authorKey, songKey) {
    document.getElementById('songSelect').value = songKey;
    try {
        const response = await fetch(`${window.FIREBASE_DB_URL}/scores/${authorKey}/${songKey}.json`);
        const songData = await response.json();
        if (songData) {
            window.loadedSong = songData;
            window.importSongFromJSON(songData);
            document.getElementById('nowPlayingTitle').innerText = songData.name || songKey.replace(/_/g, " ");
            document.getElementById('nowPlayingAuthor').innerText = authorKey.replace(/_/g, " ").toUpperCase();
            
            const notesArea = document.getElementById('songNotesArea');
            if (notesArea) notesArea.value = songData.notes || "";
        }
    } catch(e) { console.error("Errore pre-load:", e); }
};

// [HOOK: PLAYLIST_LOGIC]
window.startAuthorPlaylist = async function() {
    // Risveglia l'ambiente audio per prevenire blocchi del browser alla riproduzione successiva
    if (!audioCtx) await window.initAudioEngine();
    if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();

    const authorKey = document.getElementById('authorSelect').value;
    if (!authorKey || !window.firebaseDatabase[authorKey]) return alert("Seleziona una raccolta!");
    const songKeys = Object.keys(window.firebaseDatabase[authorKey]).filter(k => k !== '_authorNotes');
    if (songKeys.length === 0) return alert("La raccolta è vuota!");

    window.isPlaylistMode = true;
    window.playlistAuthor = authorKey;
    window.playlistSongKeys = songKeys;
    window.playlistIndex = 0;
    
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
            document.getElementById('nowPlayingTitle').innerText = songData.name || songKey.replace(/_/g, " ");
            document.getElementById('nowPlayingAuthor').innerText = authorKey.replace(/_/g, " ").toUpperCase();
            
            const notesArea = document.getElementById('songNotesArea');
            if (notesArea) notesArea.value = songData.notes || "";

            setTimeout(() => { 
                if (window.isPlaylistMode && window.playComposition) window.playComposition(false); 
            }, 300);
        } else {
            window.playNextInPlaylist();
        }
    } catch(e) { window.playNextInPlaylist(); }
};

// [PULSANTI AVANTI E INDIETRO FORZATI]
window.playNextInPlaylist = function() {
    const authorKey = document.getElementById('authorSelect').value;
    if (!authorKey || !window.firebaseDatabase[authorKey]) return alert("Seleziona una raccolta!");
    
    const songKeys = Object.keys(window.firebaseDatabase[authorKey]).filter(k => k !== '_authorNotes');
    if (songKeys.length === 0) return alert("La raccolta è vuota!");
    
    window.isPlaylistMode = true;
    window.playlistAuthor = authorKey;
    window.playlistSongKeys = songKeys;
    
    const currentSongKey = document.getElementById('songSelect').value;
    let idx = songKeys.indexOf(currentSongKey);
    idx++;
    if (idx >= songKeys.length) idx = 0;
    
    window.playlistIndex = idx;
    window.loadAndPlayPlaylistSong();
};

window.playPrevInPlaylist = function() {
    const authorKey = document.getElementById('authorSelect').value;
    if (!authorKey || !window.firebaseDatabase[authorKey]) return alert("Seleziona una raccolta!");
    
    const songKeys = Object.keys(window.firebaseDatabase[authorKey]).filter(k => k !== '_authorNotes');
    if (songKeys.length === 0) return alert("La raccolta è vuota!");
    
    window.isPlaylistMode = true;
    window.playlistAuthor = authorKey;
    window.playlistSongKeys = songKeys;
    
    const currentSongKey = document.getElementById('songSelect').value;
    let idx = songKeys.indexOf(currentSongKey);
    idx--;
    if (idx < 0) idx = songKeys.length - 1;
    
    window.playlistIndex = idx;
    window.loadAndPlayPlaylistSong();
};

window.toggleSheetView = function() {
    const sheet = document.getElementById('sheetStage');
    if (sheet.style.display === 'none') {
        sheet.style.display = 'block';
        window.dispatchEvent(new Event('resize'));
    } else {
        sheet.style.display = 'none';
    }
};

window.openCloudManager = function() {
    document.getElementById('cloudModal').style.display = 'flex';
};

// [HOOK: MOBILE_SIDEBAR]
window.toggleSidebar = function() {
    const sidebar = document.querySelector('.sidebar');
    sidebar.classList.toggle('mobile-open');
};

// Chiudi la sidebar se si clicca fuori (nello stage) su mobile
window.addEventListener('click', (e) => {
    const sidebar = document.querySelector('.sidebar');
    const menuBtn = document.querySelector('.mobile-menu-btn');
    if (window.innerWidth <= 1024 && sidebar && sidebar.classList.contains('mobile-open')) {
        if (!sidebar.contains(e.target) && !menuBtn.contains(e.target)) {
            sidebar.classList.remove('mobile-open');
        }
    }
});