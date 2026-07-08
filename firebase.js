// [HOOK: FIREBASE_AUDIO]
window.loadAudioSourcesFromFirebase = async function() {
    try {
        const response = await fetch(`${window.FIREBASE_DB_URL}/audio_sources.json`);
        const data = await response.json();
        const select = document.getElementById('audioSourceSelect');
        select.innerHTML = '<option value="https://tonejs.github.io/audio/salamander/">Yamaha C5 (Default)</option>';
        if (data) {
            for (const [key, source] of Object.entries(data)) {
                const opt = document.createElement('option');
                opt.value = source.url; opt.textContent = "☁️ " + source.name;
                select.appendChild(opt);
            }
        }
    } catch (e) { console.error(e); }
};

window.saveAudioSourceToFirebase = async function() {
    const name = document.getElementById('newAudioSourceName').value.trim();
    let url = document.getElementById('newAudioSourceUrl').value.trim();
    if (!name || !url) return alert("Inserisci nome e URL per lo strumento!");
    if (!url.endsWith('/') && !url.endsWith('%2F')) url += '/';

    const key = name.toLowerCase().replace(/ /g, "_").replace(/[^a-z0-9_]/g, "");
    try {
        const response = await fetch(`${window.FIREBASE_DB_URL}/audio_sources/${key}.json`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, url: url })
        });
        if (response.ok) {
            alert("Strumento salvato!"); window.loadAudioSourcesFromFirebase();
        }
    } catch (e) { alert("Errore: " + e); }
};

// [HOOK: FIREBASE_SCORES]
window.loadSongsListFromFirebase = async function() {
    try {
        const response = await fetch(`${window.FIREBASE_DB_URL}/scores.json`);
        window.firebaseDatabase = await response.json();
        const authorSelect = document.getElementById('authorSelect');
        authorSelect.innerHTML = '<option value="">-- Autore / Raccolta --</option>';
        if (window.firebaseDatabase) {
            for (const authorName of Object.keys(window.firebaseDatabase)) {
                const opt = document.createElement('option');
                opt.value = authorName; opt.textContent = authorName.replace(/_/g, " ").toUpperCase();
                authorSelect.appendChild(opt);
            }
        }
    } catch (e) { console.error(e); }
};

window.onAuthorSelected = function(authorKey) {
    const songSelect = document.getElementById('songSelect');
    const panel = document.getElementById('cloudActionsPanel');
    
    // Nascondiamo il pannello azioni quando si cambia la raccolta
    if (panel) panel.style.display = 'none';
    
    songSelect.innerHTML = '<option value="">-- Brano --</option>';
    if (!authorKey || !window.firebaseDatabase[authorKey]) { songSelect.disabled = true; return; }
    for (const [songKey, songObj] of Object.entries(window.firebaseDatabase[authorKey])) {
        const opt = document.createElement('option');
        opt.value = songKey; opt.textContent = songObj.name || songKey.replace(/_/g, " ");
        songSelect.appendChild(opt);
    }
    songSelect.disabled = false;
};

window.onSongSelected = async function(songKey) {
    const authorKey = document.getElementById('authorSelect').value;
    const panel = document.getElementById('cloudActionsPanel');
    const notesArea = document.getElementById('songNotesArea');

    if (!authorKey || !songKey) {
        if (panel) panel.style.display = 'none';
        return;
    }
    
    try {
        const response = await fetch(`${window.FIREBASE_DB_URL}/scores/${authorKey}/${songKey}.json`);
        const songData = await response.json();
        if (songData) {
            window.loadedSong = songData;
            window.importSongFromJSON(songData);
            alert("Brano Cloud caricato. Vai su 'Suona Spartito' per vederlo.");
            
            // Mostriamo il pannello e carichiamo le note esistenti (se presenti)
            if (panel) panel.style.display = 'block';
            if (notesArea) notesArea.value = songData.notes || "";
        }
    } catch(e) { alert("Errore download: " + e); }
};

// [NUOVO] Funzione per salvare le note/testo modificate nel Firebase Cloud
window.saveSongNotes = async function() {
    const authorKey = document.getElementById('authorSelect').value;
    const songKey = document.getElementById('songSelect').value;
    const notesArea = document.getElementById('songNotesArea');
    
    if (!authorKey || !songKey) return alert("Seleziona prima un brano!");
    
    const newNotes = notesArea.value;

    try {
        const response = await fetch(`${window.FIREBASE_DB_URL}/scores/${authorKey}/${songKey}/notes.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newNotes)
        });
        
        if (response.ok) {
            if (window.loadedSong) window.loadedSong.notes = newNotes;
            alert("Testo/Note salvate con successo nel Cloud! 💾");
        } else {
            alert("Errore durante il salvataggio.");
        }
    } catch (e) {
        alert("Errore di rete: " + e);
    }
};

// [NUOVO] Funzione per eliminare un singolo brano dal DB
window.deleteCurrentSong = async function() {
    const authorKey = document.getElementById('authorSelect').value;
    const songKey = document.getElementById('songSelect').value;
    
    if (!authorKey || !songKey) return alert("Nessun brano selezionato.");
    if (!confirm(`Sei sicuro di voler eliminare definitivamente il brano "${songKey}"?

Questa azione NON può essere annullata.`)) return;
    
    try {
        const response = await fetch(`${window.FIREBASE_DB_URL}/scores/${authorKey}/${songKey}.json`, { method: 'DELETE' });
        if (response.ok) {
            alert("Brano eliminato con successo!");
            document.getElementById('cloudActionsPanel').style.display = 'none';
            document.getElementById('songSelect').value = "";
            window.loadSongsListFromFirebase();
        } else {
            alert("Errore durante l'eliminazione.");
        }
    } catch (e) { alert("Errore di rete: " + e); }
};

// [NUOVO] Funzione per eliminare l'intera raccolta dal DB
window.deleteCurrentAuthor = async function() {
    const authorKey = document.getElementById('authorSelect').value;
    if (!authorKey) return alert("Nessuna raccolta selezionata.");
    
    if (!confirm(`💣 ATTENZIONE!
Vuoi davvero eliminare l'intera raccolta "${authorKey}" e TUTTI i suoi brani?

Questa operazione è IRREVERSIBILE.`)) return;
    
    try {
        const response = await fetch(`${window.FIREBASE_DB_URL}/scores/${authorKey}.json`, { method: 'DELETE' });
        if (response.ok) {
            alert("Raccolta e brani associati eliminati con successo!");
            document.getElementById('cloudActionsPanel').style.display = 'none';
            document.getElementById('authorSelect').value = "";
            window.onAuthorSelected("");
            window.loadSongsListFromFirebase();
        } else {
            alert("Errore durante l'eliminazione.");
        }
    } catch (e) { alert("Errore di rete: " + e); }
};
// [HOOK: FIREBASE_SAVE_SONG]
window.saveSongToFirebase = async function() {
    if (!window.loadedSong) return alert("Carica prima un brano tramite il Metodo A (File Locale)!");
    const author = document.getElementById('saveAuthorInput').value.trim().replace(/[^a-zA-Z0-9_]/g, "_");
    const song = document.getElementById('saveSongInput').value.trim().replace(/[^a-zA-Z0-9_]/g, "_");
    
    if (!author || !song) return alert("Inserisci Autore e Nome Brano!");

    try {
        const response = await fetch(`${window.FIREBASE_DB_URL}/scores/${author}/${song}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(window.loadedSong)
        });
        if (response.ok) {
            alert("Brano archiviato con successo nel Cloud!");
            window.loadSongsListFromFirebase(); // Aggiorna i menu a tendina
        } else {
            alert("Errore durante il salvataggio.");
        }
    } catch (e) {
        alert("Errore di rete: " + e);
    }
};