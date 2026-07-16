window.loadAudioSourcesFromFirebase = async function() {
    try {
        const response = await fetch(`${window.FIREBASE_DB_URL}/audio_sources.json`);
        const data = await response.json();
        const select = document.getElementById('audioSourceSelect');
        if (data) {
            for (const [key, source] of Object.entries(data)) {
                const opt = document.createElement('option');
                opt.value = source.url; opt.textContent = "☁️ " + source.name;
                select.appendChild(opt);
            }
        }
    } catch (e) {}
};

window.loadSongsListFromFirebase = async function() {
    try {
        const response = await fetch(`${window.FIREBASE_DB_URL}/scores.json`);
        window.firebaseDatabase = await response.json();
        
        const authorSelect = document.getElementById('authorSelect');
        authorSelect.innerHTML = '<option value="">-- Seleziona Raccolta --</option>';
        const datalist = document.getElementById('existingAuthorsList');
        if (datalist) datalist.innerHTML = '';
        
        if (window.firebaseDatabase) {
            for (const authorName of Object.keys(window.firebaseDatabase)) {
                const formattedName = authorName.replace(/_/g, " ").toUpperCase();
                const opt = document.createElement('option');
                opt.value = authorName; opt.textContent = formattedName;
                authorSelect.appendChild(opt);
                
                if (datalist) {
                    const dataOpt = document.createElement('option');
                    dataOpt.value = authorName; datalist.appendChild(dataOpt);
                }
            }
        }
    } catch (e) {}
};

window.onAuthorSelected = function(authorKey, isSystemAction = false) {
    if (!isSystemAction) window.isPlaylistMode = false;
    const songSelect = document.getElementById('songSelect');
    songSelect.innerHTML = '<option value="">-- Brano --</option>';
    
    const authorNotesArea = document.getElementById('authorNotesArea');
    if (authorNotesArea && window.firebaseDatabase[authorKey]) {
        authorNotesArea.value = window.firebaseDatabase[authorKey]['_authorNotes'] || "";
    }

    if (!authorKey || !window.firebaseDatabase[authorKey]) { songSelect.disabled = true; return; }

    for (const [songKey, songObj] of Object.entries(window.firebaseDatabase[authorKey])) {
        if (songKey === '_authorNotes') continue; 
        const opt = document.createElement('option');
        opt.value = songKey; opt.textContent = songObj.name || songKey.replace(/_/g, " ");
        songSelect.appendChild(opt);
    }
    songSelect.disabled = false;
};

window.onSongSelected = async function(songKey) {
    window.isPlaylistMode = false;
    const authorKey = document.getElementById('authorSelect').value;
    if (!authorKey || !songKey) return;
    await window.preloadFirstSong(authorKey, songKey);
};

window.saveSongToFirebase = async function() {
    if (!window.loadedSong) return alert("Carica prima un brano tramite File JSON Locale!");
    const author = document.getElementById('saveAuthorInput').value.trim().replace(/[^a-zA-Z0-9_]/g, "_");
    const song = document.getElementById('saveSongInput').value.trim().replace(/[^a-zA-Z0-9_]/g, "_");
    if (!author || !song) return alert("Inserisci Autore e Nome Brano!");

    try {
        const response = await fetch(`${window.FIREBASE_DB_URL}/scores/${author}/${song}.json`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(window.loadedSong)
        });
        if (response.ok) { alert("Archiviato!"); window.loadSongsListFromFirebase(); }
    } catch (e) { alert("Errore: " + e); }
};