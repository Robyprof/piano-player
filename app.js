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
                    window.loadedSong = JSON.parse(evt.target.result);
                    window.importSongFromJSON(window.loadedSong);
                    alert("File Locale Caricato! Vai su 'Suona Spartito' per vederlo, o archivialo nel Cloud tramite il riquadro sottostante.");
                } catch (err) { alert("Errore nel file: " + err.message); }
            }; 
            reader.readAsText(file);
        });
    }
});