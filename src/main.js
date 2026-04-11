import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
        import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
        import { getFirestore, collection, getDocs, doc, updateDoc, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
        import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

        const firebaseConfig = { apiKey: "AIzaSyC0yzzu9f6PM0zfnr463jRdsRrXpkqP-YA", authDomain: "solosola-v4.firebaseapp.com", projectId: "solosola-v4", storageBucket: "solosola-v4.firebasestorage.app", messagingSenderId: "937332002715", appId: "1:937332002715:web:17d4933814874b2d7adb3e" };
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        const storage = getStorage(app);

        import { useStore, subscribeToStore } from './store/useStore.js';

        // Storeからの初期化
        let SYSTEM_DATA = useStore.getState().systemData;
        let currentSetKey = useStore.getState().currentSetKey;
        let currentUser = useStore.getState().currentUser;
        
        // ZustandのSubscribeで変数を常に同期（段階的移行のためローカル変数とStoreを同期させる）
        subscribeToStore(state => state.systemData, data => SYSTEM_DATA = data);
        subscribeToStore(state => state.currentSetKey, key => currentSetKey = key);
        subscribeToStore(state => state.currentUser, user => currentUser = user);

        let audioContext;
        let audioBuffers = new Array(16);
        const playingNodes = {};
        const pressedKeys = new Set();
        
        let isHoldMode = useStore.getState().isHoldMode;
        let isFxMode = useStore.getState().isFxMode;
        subscribeToStore(state => state.isHoldMode, mode => isHoldMode = mode);
        subscribeToStore(state => state.isFxMode, mode => isFxMode = mode);

        let masterFilterNode, masterReverbNode, masterReverbGain, masterDryGain, masterCompressor;
        const keyMap = ['1', '2', '3', '4', 'q', 'w', 'e', 'r', 'a', 's', 'd', 'f', 'z', 'x', 'c', 'v'];

        let playCount = 0;
        let isStandalone = false, isInAppBrowser = false;
        
        let isFeedOpen = useStore.getState().isFeedOpen;
        subscribeToStore(state => state.isFeedOpen, open => isFeedOpen = open);

        let appMode = useStore.getState().appMode;
        subscribeToStore(state => state.appMode, mode => appMode = mode);

        let targetEditPadId = useStore.getState().targetEditPadId;
        let spoidedSampleData = useStore.getState().spoidedSampleData;
        let tempEditingSample = useStore.getState().tempEditingSample;
        
        subscribeToStore(state => state.targetEditPadId, id => targetEditPadId = id);
        subscribeToStore(state => state.spoidedSampleData, data => spoidedSampleData = data);
        subscribeToStore(state => state.tempEditingSample, sample => tempEditingSample = sample);

        const silentWav = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
        let stayAliveAudio = new Audio(silentWav);
        stayAliveAudio.loop = true;
        stayAliveAudio.volume = 0.01;

        let isAudioEngineInitialized = false;

        window.addEventListener('contextmenu', e => e.preventDefault(), { passive: false });

        function initAudioEngine() {
            if (isAudioEngineInitialized) return;
            isAudioEngineInitialized = true;
            if ('audioSession' in navigator) { try { navigator.audioSession.type = 'playback'; } catch (e) { } }
            stayAliveAudio.play().catch(e => { console.log("Stay-alive audio blocked", e); });
            if ('mediaSession' in navigator) { navigator.mediaSession.playbackState = 'playing'; }
        }

        function unlockAudioContextMaster(e) {
            if (!audioContext) initAudioContext();
            if (audioContext && audioContext.state === 'suspended') audioContext.resume();
            if (!isAudioEngineInitialized) initAudioEngine();
        }

        ['touchstart', 'touchend', 'mousedown', 'click'].forEach(evt => {
            document.addEventListener(evt, unlockAudioContextMaster, { capture: true, passive: true });
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                if (audioContext) {
                    let lastTime = audioContext.currentTime;
                    setTimeout(() => {
                        if (audioContext.currentTime === lastTime) {
                            console.log("AudioContext Zombie detected! Rebuilding...");
                            audioContext.close().then(() => {
                                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                                setupMasterFX();
                                preloadAllSamples();
                            });
                        } else if (audioContext.state === 'suspended') {
                            audioContext.resume();
                        }
                    }, 50);
                }
                if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
                stayAliveAudio.play().catch(e => { });
            }
        });

        onAuthStateChanged(auth, (user) => { currentUser = user; renderDynamicMenu(); });
        window.handleGoogleLogin = function () { signInWithPopup(auth, new GoogleAuthProvider()).catch(err => { alert("Login Failed: " + err.message); }); };
        window.handleGoogleLogout = function () { signOut(auth).then(() => { alert("ログアウトしました"); closeModal('main-menu-overlay'); cancelMode(); }); };

        // 【FIX】FXゾーンの貫通防止ユーティリティ
        function toggleFxZoneInteraction(enable) {
            const fxZone = document.getElementById('mobile-fx-zone');
            if (fxZone) fxZone.style.pointerEvents = enable ? 'auto' : 'none';
        }

        function renderDynamicMenu() {
            const container = document.getElementById('dynamic-menu-container');
            const profileInfo = document.getElementById('user-profile-info');
            container.innerHTML = '<h3>MENU</h3>';

            const currentSetData = SYSTEM_DATA.sets[currentSetKey];
            const isMySet = currentUser && currentSetData && currentSetData.ownerId === currentUser.uid;

            if (currentUser) {
                profileInfo.innerText = `Logged in as: ${currentUser.email}`;
            } else {
                profileInfo.innerText = '';
                container.innerHTML += `
                    <div class="modal-menu-item google-login" onclick="handleGoogleLogin()"><span style="color:#4285F4;">G</span> Login with Google</div>
                    <div class="modal-menu-item disabled" onclick="alert('ログインすると、自分の音を追加したり編集できるようになります。')"><span>🔒 音を追加・編集 (Lite Edit)</span></div>
                    <div class="modal-menu-item disabled" onclick="alert('ログインすると、他人の音を自分のセットにコピーできるようになります。')"><span>🔒 このセットをコピー (Resample)</span></div>
                `;
            }

            if (isMySet) {
                container.innerHTML += `<div class="modal-menu-item" onclick="enterMode('EDIT')"><span>音を追加・編集 (Lite Edit)</span><span class="icon">▶</span></div>`;
            } else if (currentUser && currentSetData) {
                container.innerHTML += `<div class="modal-menu-item pro" onclick="enterMode('SPOID')"><span>このセットから音をコピー (Resample)</span><span class="icon">▶</span></div>`;
            }

            container.innerHTML += `
                <div class="modal-menu-item" onclick="copyShareUrl()"><span id="share-btn-text">この音をシェア (Share)</span><span class="icon">▶</span></div>
                <a href="./editor_v4.html" target="_blank" rel="noopener noreferrer" class="modal-menu-item pro"><span>高度な編集 (Studio Proへ)</span><span class="icon">↗</span></a>
            `;
            if (currentUser) { container.innerHTML += `<div class="modal-menu-item danger" onclick="handleGoogleLogout()" style="margin-top:20px;"><span>ログアウト</span><span class="icon">▶</span></div>`; }
        }

        window.enterMode = function (mode) {
            useStore.getState().setAppMode(mode);
            closeModal('main-menu-overlay');
            const wrapper = document.getElementById('sampler-wrapper');
            const banner = document.getElementById('mode-banner');
            const bannerText = document.getElementById('mode-banner-text');

            wrapper.className = ''; banner.className = '';
            if (mode === 'EDIT') { wrapper.classList.add('mode-edit'); banner.classList.add('show', 'edit'); bannerText.innerText = 'EDIT: 編集するパッドをタップ'; }
            else if (mode === 'SPOID') { wrapper.classList.add('mode-spoid'); banner.classList.add('show', 'spoid'); bannerText.innerText = 'SPOID: コピーする音をタップ'; }
            else if (mode === 'PASTE') { wrapper.classList.add('mode-paste'); banner.classList.add('show', 'paste'); bannerText.innerText = 'PASTE: 上書きするパッドをタップ'; }
        };

        window.cancelMode = function () {
            useStore.getState().cancelMode();
            document.getElementById('sampler-wrapper').className = '';
            document.getElementById('mode-banner').className = '';
        };

        async function processModeClick(id) {
            if (appMode === 'EDIT') {
                targetEditPadId = id; openPadEditModal(id); return true;
            }
            if (appMode === 'SPOID') {
                const sampleData = SYSTEM_DATA.sets[currentSetKey].samples.find(s => s.id == id);
                if (!sampleData || !sampleData.url) { alert("このパッドには音がありません。"); return true; }
                spoidedSampleData = JSON.parse(JSON.stringify(sampleData));
                triggerSample(id);
                alert("音をコピーしました。\nペースト先の自分のセットを選択してください。");
                renderMySetsFeed();
                document.getElementById('feed-overlay').classList.add('show');
                isFeedOpen = true;
                toggleFxZoneInteraction(false);
                return true;
            }
            if (appMode === 'PASTE') {
                if (!spoidedSampleData) { cancelMode(); return true; }
                if (confirm(`このパッドに音を上書きペーストしますか？`)) {
                    document.getElementById('loading-indicator').style.display = 'block';
                    document.getElementById('loading-indicator').innerText = 'UPDATING DATABASE...';
                    try {
                        const currentSetData = SYSTEM_DATA.sets[currentSetKey];
                        const newSamples = [...currentSetData.samples];
                        const index = newSamples.findIndex(s => s.id == id);
                        spoidedSampleData.id = parseInt(id);
                        if (index !== -1) newSamples[index] = spoidedSampleData; else newSamples.push(spoidedSampleData);
                        await updateDoc(doc(db, "sets", currentSetKey), { samples: newSamples });
                        SYSTEM_DATA.sets[currentSetKey].samples = newSamples;
                        await preloadSingleSample(spoidedSampleData);
                        renderPads(SYSTEM_DATA.sets[currentSetKey]);
                        cancelMode();
                    } catch (e) { alert("エラーが発生しました: " + e.message); }
                    finally { document.getElementById('loading-indicator').style.display = 'none'; }
                }
                return true;
            }
            return false;
        }

        function openPadEditModal(id) {
            const currentSetData = SYSTEM_DATA.sets[currentSetKey];
            const sample = currentSetData.samples.find(s => s.id == id) || { id: parseInt(id), mode: 'gate', loop: false, url: "", label: "" };

            tempEditingSample = JSON.parse(JSON.stringify(sample));
            document.getElementById('modal-edit-title').innerText = `EDIT PAD ${id}`;
            document.getElementById('modal-edit-label').value = tempEditingSample.label || '';
            document.getElementById('modal-edit-mode').value = tempEditingSample.mode || 'gate';
            document.getElementById('modal-edit-loop').checked = !!tempEditingSample.loop;
            document.getElementById('modal-edit-fadeIn').checked = !!tempEditingSample.fadeIn;
            document.getElementById('modal-edit-random').checked = !!tempEditingSample.randomStart;

            document.getElementById('modal-file-name').innerText = tempEditingSample.url ? "✅ 音源設定済み" : "No file selected";
            document.getElementById('modal-file-input').value = '';
            openModal('pad-edit-overlay');
        }

        async function convertToMP3Blob(file) {
            return new Promise(async (resolve, reject) => {
                try {
                    if (!audioContext) initAudioContext();
                    const arrayBuffer = await file.arrayBuffer();
                    const audioBuf = await audioContext.decodeAudioData(arrayBuffer);
                    const channels = audioBuf.numberOfChannels;
                    const sampleRate = audioBuf.sampleRate;
                    const mp3encoder = new window.lamejs.Mp3Encoder(channels, sampleRate, 128);
                    const mp3Data = [];
                    const sampleBlockSize = 1152;
                    const left = audioBuf.getChannelData(0);
                    const right = channels > 1 ? audioBuf.getChannelData(1) : left;

                    const leftInt16 = new Int16Array(left.length);
                    const rightInt16 = new Int16Array(right.length);
                    for (let i = 0; i < left.length; i++) {
                        leftInt16[i] = Math.max(-32768, Math.min(32767, left[i] * 32768));
                        if (channels > 1) { rightInt16[i] = Math.max(-32768, Math.min(32767, right[i] * 32768)); }
                    }
                    for (let i = 0; i < leftInt16.length; i += sampleBlockSize) {
                        const leftChunk = leftInt16.subarray(i, i + sampleBlockSize);
                        let mp3buf;
                        if (channels > 1) { const rightChunk = rightInt16.subarray(i, i + sampleBlockSize); mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk); }
                        else { mp3buf = mp3encoder.encodeBuffer(leftChunk); }
                        if (mp3buf.length > 0) mp3Data.push(mp3buf);
                    }
                    const mp3buf = mp3encoder.flush();
                    if (mp3buf.length > 0) mp3Data.push(mp3buf);
                    resolve(new Blob(mp3Data, { type: 'audio/mp3' }));
                } catch (e) { reject(e); }
            });
        }

        document.getElementById('modal-file-input').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file || targetEditPadId === null || !currentUser) return;
            const uploadBtnLabel = document.getElementById('upload-btn-label');
            const originalText = uploadBtnLabel.innerHTML;
            uploadBtnLabel.innerHTML = '⚙️ Converting & Uploading...';
            uploadBtnLabel.style.pointerEvents = 'none';

            try {
                const mp3Blob = await convertToMP3Blob(file);
                const originalNameBase = file.name.replace(/\.[^/.]+$/, "");
                const newFileName = `${originalNameBase}.mp3`;

                const storageRef = ref(storage, `users/${currentUser.uid}/${currentSetKey}/${Date.now()}_${newFileName}`);
                await uploadBytes(storageRef, mp3Blob);
                const downloadURL = await getDownloadURL(storageRef);

                tempEditingSample.url = downloadURL;
                document.getElementById('modal-file-name').innerText = newFileName + " (Converted)";
                const cleanName = originalNameBase.substring(0, 15);
                document.getElementById('modal-edit-label').value = cleanName;
                tempEditingSample.label = cleanName;
            } catch (error) { alert("ファイルの変換またはアップロードに失敗しました: " + error.message); }
            finally { uploadBtnLabel.innerHTML = originalText; uploadBtnLabel.style.pointerEvents = 'auto'; }
        });

        window.savePadEdit = async function () {
            if (!tempEditingSample) return;
            tempEditingSample.label = document.getElementById('modal-edit-label').value;
            tempEditingSample.mode = document.getElementById('modal-edit-mode').value;
            tempEditingSample.loop = document.getElementById('modal-edit-loop').checked;
            tempEditingSample.fadeIn = document.getElementById('modal-edit-fadeIn').checked;
            tempEditingSample.randomStart = document.getElementById('modal-edit-random').checked;

            document.getElementById('loading-indicator').style.display = 'block';
            document.getElementById('loading-indicator').innerText = 'SAVING PAD...';

            try {
                const currentSetData = SYSTEM_DATA.sets[currentSetKey];
                const newSamples = [...currentSetData.samples];
                const index = newSamples.findIndex(s => s.id == targetEditPadId);

                if (index !== -1) newSamples[index] = tempEditingSample; else newSamples.push(tempEditingSample);
                await updateDoc(doc(db, "sets", currentSetKey), { samples: newSamples });
                SYSTEM_DATA.sets[currentSetKey].samples = newSamples;
                await preloadSingleSample(tempEditingSample);
                renderPads(SYSTEM_DATA.sets[currentSetKey]);
                closeModal('pad-edit-overlay');
            } catch (error) { alert("保存エラー: " + error.message); }
            finally { document.getElementById('loading-indicator').style.display = 'none'; }
        };

        window.clearPadEdit = async function () {
            if (!confirm("このパッドの音源を消去しますか？")) return;
            tempEditingSample.url = ""; tempEditingSample.label = "";
            document.getElementById('modal-edit-label').value = "";
            document.getElementById('modal-file-name').innerText = "No file selected";
            await savePadEdit();
        };

        async function preloadSingleSample(sample) {
            if (!sample || !sample.url) return;
            try {
                const response = await fetch(sample.url);
                const buf = await response.arrayBuffer();
                audioBuffers[sample.id] = await audioContext.decodeAudioData(buf);
            } catch (e) { console.error("Audio Decode Error", e); }
        }

        window.openModal = function (id) {
            const overlay = document.getElementById(id);
            overlay.style.display = 'flex'; setTimeout(() => overlay.classList.add('show'), 10);
            if (id === 'main-menu-overlay') localStorage.setItem('tutorialShown', 'true');
            toggleFxZoneInteraction(false);
        };
        window.closeModal = function (id) {
            const overlay = document.getElementById(id);
            overlay.classList.remove('show'); setTimeout(() => overlay.style.display = 'none', 300);
            if (!isFeedOpen) toggleFxZoneInteraction(true);
        };
        window.copyShareUrl = function () { navigator.clipboard.writeText(window.location.href).then(() => { const textSpan = document.getElementById('share-btn-text'); const originalText = textSpan.innerText; textSpan.innerText = "COPIED!"; textSpan.style.color = "var(--success-color)"; setTimeout(() => { textSpan.innerText = originalText; textSpan.style.color = "#fff"; }, 2000); }); };

        window.addEventListener('DOMContentLoaded', () => {
            isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
            const ua = navigator.userAgent || navigator.vendor || window.opera;
            const isIos = /iphone|ipad|ipod/.test(ua.toLowerCase());
            isInAppBrowser = (ua.indexOf('FBAN') > -1) || (ua.indexOf('FBAV') > -1) || (ua.indexOf('Instagram') > -1) || (ua.indexOf('Line') > -1) || (ua.indexOf('Twitter') > -1);

            if (isInAppBrowser && !isStandalone) document.getElementById('inapp-warning').style.display = 'flex';
            else if (!localStorage.getItem('tutorialShown')) setTimeout(() => openModal('main-menu-overlay'), 600);

            if (isStandalone) { document.getElementById('pwa-fab').style.display = 'none'; document.getElementById('pwa-prompt').style.display = 'none'; }
            else if (!isInAppBrowser) { document.getElementById('pwa-fab').style.display = 'flex'; }

            setupHoldButtons();
        });

        window.togglePwaPrompt = function () { document.getElementById('pwa-prompt').classList.toggle('show'); };
        window.closePwaPrompt = function (e) { e.stopPropagation(); document.getElementById('pwa-prompt').classList.remove('show'); localStorage.setItem('pwaPromptDismissed', 'true'); };

        window.addEventListener('DOMContentLoaded', async () => { await loadCloudData(); });

        async function loadCloudData() {
            try {
                const urlParams = new URLSearchParams(window.location.search);
                const targetUserId = urlParams.get('u');
                const targetSetId = urlParams.get('set');

                let q;
                if (targetUserId) q = query(collection(db, "sets"), where("ownerId", "==", targetUserId));
                else q = collection(db, "sets");

                const querySnapshot = await getDocs(q);
                let defaultSetId = null;
                let mainSetId = null;

                if (!querySnapshot.empty) {
                    querySnapshot.forEach((doc) => {
                        const data = doc.data();
                        SYSTEM_DATA.sets[doc.id] = data;
                        if (!defaultSetId) defaultSetId = doc.id;
                        if (data.isMain === true) mainSetId = doc.id;
                    });

                    if (targetSetId && SYSTEM_DATA.sets[targetSetId]) changeSamplerSet(targetSetId);
                    else if (targetUserId && mainSetId) changeSamplerSet(mainSetId);
                    else if (defaultSetId) changeSamplerSet(defaultSetId);
                }
            } catch (error) { console.error(error); }
            finally { document.getElementById('loading-indicator').style.display = 'none'; renderDynamicMenu(); }
        }

        window.switchFeed = function (feedType) {
            const overlay = document.getElementById('feed-overlay');
            const tabs = document.querySelectorAll('.feed-tab');
            const targetTab = Array.from(tabs).find(t => t.innerText.toLowerCase() === feedType);

            if (targetTab && targetTab.classList.contains('active') && isFeedOpen) {
                overlay.classList.remove('show'); isFeedOpen = false; toggleFxZoneInteraction(true); return;
            }
            tabs.forEach(el => el.classList.remove('active'));
            if (targetTab) targetTab.classList.add('active');

            if (feedType === 'main') { renderFeedList(); overlay.classList.add('show'); isFeedOpen = true; toggleFxZoneInteraction(false); }
            else { overlay.innerHTML = `<div style="padding:40px 20px; color:#888; text-align:center; font-weight:300;">${feedType.toUpperCase()} feed coming in Phase 2.2</div>`; overlay.classList.add('show'); isFeedOpen = true; toggleFxZoneInteraction(false); }
        };

        function renderFeedList() {
            const container = document.getElementById('feed-overlay');
            container.innerHTML = '';
            Object.keys(SYSTEM_DATA.sets).forEach(key => {
                const s = SYSTEM_DATA.sets[key];
                const el = document.createElement('div');
                el.className = `feed-list-item ${key === currentSetKey ? 'active' : ''}`;
                const mainBadge = s.isMain ? `<span class="badge-main">MAIN</span>` : '';
                el.innerHTML = `<div class="feed-list-title">${s.name} ${mainBadge}</div><div class="feed-list-sub">by ${s.recorder || 'Unknown'}</div>`;
                el.onclick = () => { changeSamplerSet(key); document.getElementById('feed-overlay').classList.remove('show'); isFeedOpen = false; toggleFxZoneInteraction(true); };
                container.appendChild(el);
            });
        }

        function renderMySetsFeed() {
            const container = document.getElementById('feed-overlay');
            container.innerHTML = '<div style="padding: 20px; color:#00ffaa; font-weight:bold; letter-spacing:0.1em; border-bottom: 1px solid #333;">ペースト先のセットを選択</div>';
            Object.keys(SYSTEM_DATA.sets).forEach(key => {
                const s = SYSTEM_DATA.sets[key];
                if (currentUser && s.ownerId === currentUser.uid) {
                    const el = document.createElement('div'); el.className = `feed-list-item`;
                    const mainBadge = s.isMain ? `<span class="badge-main">MAIN</span>` : '';
                    el.innerHTML = `<div class="feed-list-title">${s.name} ${mainBadge}</div>`;
                    el.onclick = async () => {
                        document.getElementById('feed-overlay').classList.remove('show'); isFeedOpen = false; toggleFxZoneInteraction(true);
                        await changeSamplerSet(key);
                        enterMode('PASTE');
                    };
                    container.appendChild(el);
                }
            });
        }

        window.changeSamplerSet = async function (setKey) {
            if (!SYSTEM_DATA.sets[setKey]) return;
            if (!audioContext) initAudioContext();
            stopAllSounds(true, true);
            currentSetKey = setKey;
            const newData = SYSTEM_DATA.sets[setKey];

            const p2 = document.getElementById('place-name-pc'); if (p2) p2.textContent = newData.name;
            const r2 = document.getElementById('recorder-name-pc'); if (r2) r2.textContent = newData.recorder;

            let newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
            if (newData.ownerId) newUrl += '?u=' + newData.ownerId + '&set=' + setKey;
            else newUrl += '?set=' + setKey;
            window.history.pushState({ path: newUrl }, '', newUrl);

            // 【FIX】空パッドバグ対策: バッファを一度完全にパージする
            audioBuffers = new Array(16);

            renderPads(newData);
            document.getElementById('sampler-wrapper').style.opacity = 0.5;
            await preloadAllSamples();
            document.getElementById('sampler-wrapper').style.opacity = 1;
            renderDynamicMenu();
        }

        function renderPads(setData) {
            const container = document.getElementById('sampler-container'); container.innerHTML = '';
            for (let i = 0; i < 16; i++) {
                const sample = setData.samples.find(s => s.id === i) || { id: i, label: "" };
                const pad = document.createElement('div'); pad.className = 'pad'; pad.id = `pad-${i}`;
                pad.dataset.id = i; pad.dataset.key = keyMap[i];
                if (setData.image) {
                    const col = i % 4; const row = Math.floor(i / 4);
                    pad.style.backgroundImage = `url('${setData.image}')`;
                    pad.style.backgroundPosition = `${col * (100 / 3)}% ${row * (100 / 3)}%`;
                }
                const label = document.createElement('span'); label.className = 'pad-label'; label.textContent = sample.label;
                pad.appendChild(label); attachEvents(pad); container.appendChild(pad);
            }
        }

        async function preloadAllSamples() {
            const currentSetData = SYSTEM_DATA.sets[currentSetKey];
            if (!currentSetData) return;
            const loadPromises = currentSetData.samples.map(async (sample) => {
                if (!sample || !sample.url) return;
                try {
                    const response = await fetch(sample.url);
                    const buf = await response.arrayBuffer();
                    audioBuffers[sample.id] = await audioContext.decodeAudioData(buf);
                } catch (e) { }
            });
            await Promise.all(loadPromises);
        }

        function initAudioContext() {
            try { audioContext = new (window.AudioContext || window.webkitAudioContext)(); setupMasterFX(); } catch (e) { }
        }

        function setupMasterFX() {
            masterFilterNode = audioContext.createBiquadFilter(); masterFilterNode.type = 'lowpass'; masterFilterNode.frequency.value = 20000; masterFilterNode.Q.value = 1;
            masterReverbNode = audioContext.createConvolver(); masterReverbNode.buffer = createReverbBuffer(2.0);
            masterDryGain = audioContext.createGain(); masterDryGain.gain.value = 1.0;
            masterReverbGain = audioContext.createGain(); masterReverbGain.gain.value = 0.0;
            masterCompressor = audioContext.createDynamicsCompressor();
            masterCompressor.threshold.value = -10; masterCompressor.knee.value = 30; masterCompressor.ratio.value = 12; masterCompressor.attack.value = 0.003; masterCompressor.release.value = 0.25;
            masterFilterNode.connect(masterDryGain); masterFilterNode.connect(masterReverbNode);
            masterReverbNode.connect(masterReverbGain); masterDryGain.connect(masterCompressor); masterReverbGain.connect(masterCompressor);
            masterCompressor.connect(audioContext.destination);
        }

        function createReverbBuffer(duration) {
            const sampleRate = audioContext.sampleRate; const length = sampleRate * duration; const impulse = audioContext.createBuffer(2, length, sampleRate);
            for (let i = 0; i < length; i++) {
                const decay = Math.pow(1 - i / length, 2.0); impulse.getChannelData(0)[i] = (Math.random() * 2 - 1) * decay; impulse.getChannelData(1)[i] = (Math.random() * 2 - 1) * decay;
            } return impulse;
        }

        function triggerSample(id) {
            const sampleData = SYSTEM_DATA.sets[currentSetKey].samples.find(s => s.id == id);
            const buffer = audioBuffers[parseInt(id)];

            // 【FIX】空パッドタップ時のUIフィードバック
            if (!buffer || !sampleData || !sampleData.url) {
                const pad = document.getElementById(`pad-${id}`);
                const label = pad.querySelector('.pad-label');
                if (label) {
                    const origText = label.innerText;
                    label.innerText = "EMPTY"; label.style.color = "var(--danger-color)";
                    setTimeout(() => { label.innerText = origText; label.style.color = ""; }, 500);
                }
                return false;
            }

            playCount++;
            if (playCount === 10 && !isStandalone && !isInAppBrowser && !localStorage.getItem('pwaPromptDismissed')) { document.getElementById('pwa-prompt').classList.add('show'); }

            if (playingNodes[id]) {
                if (isHoldMode && sampleData.mode === 'gate') {
                    stopSample(id, true); return false;
                } else {
                    stopSample(id, true);
                }
            }

            const source = audioContext.createBufferSource(); source.buffer = buffer; source.loop = sampleData.loop || false;
            const gainNode = audioContext.createGain();
            source.connect(gainNode); gainNode.connect(masterFilterNode || audioContext.destination);
            const now = audioContext.currentTime; gainNode.gain.setValueAtTime(0, now);
            gainNode.gain.linearRampToValueAtTime(1, now + (sampleData.fadeIn ? 0.05 : 0.005));
            let startOffset = 0; if (sampleData.loop && sampleData.randomStart && buffer.duration > 1.0) startOffset = Math.random() * 0.5;
            source.start(0, startOffset);
            playingNodes[id] = { source: source, gain: gainNode, startTime: now, bufferDuration: buffer.duration };
            const pad = document.getElementById(`pad-${id}`);
            clearTimeout(pad.dataset.purifyTimer); pad.classList.remove('purifying'); pad.style.transition = ""; void pad.offsetWidth; pad.classList.add('active');
            source.onended = () => {
                if (playingNodes[id] && playingNodes[id].source === source) { delete playingNodes[id]; pad.classList.remove('active', 'purifying'); pad.style.transition = ""; }
            };
            return true;
        }

        function stopSample(id, forceStop = false) {
            const node = playingNodes[id]; if (!node) return;
            const pad = document.getElementById(`pad-${id}`);
            const sampleData = SYSTEM_DATA.sets[currentSetKey].samples.find(s => s.id == id);
            const now = audioContext.currentTime;

            if (!forceStop) { if (isHoldMode) return; if (sampleData.mode === 'oneshot') return; }

            pad.classList.remove('active'); clearTimeout(pad.dataset.purifyTimer);
            let releaseTime = 0.3;
            const pressDuration = now - node.startTime;
            const isPurifying = pad.classList.contains('purifying') || pressDuration > 0.4;
            if (isPurifying) { releaseTime = 0.5 + Math.pow(pressDuration * 0.8, 1.2); if (releaseTime > 20) releaseTime = 20; }

            try { node.gain.gain.cancelScheduledValues(now); node.gain.gain.setValueAtTime(node.gain.gain.value, now); node.gain.gain.exponentialRampToValueAtTime(0.001, now + releaseTime); node.source.stop(now + releaseTime); } catch (e) { }
            pad.classList.remove('purifying');
            if (isPurifying) pad.style.transition = `filter ${releaseTime}s cubic-bezier(0.1, 0.7, 0.1, 1), box-shadow ${releaseTime}s cubic-bezier(0.1, 0.7, 0.1, 1)`;
            else pad.style.transition = "";
            delete playingNodes[id];
        }

        // 【FIX】強制停止の明示的制御 (force引数追加)
        function stopAllSounds(immediate = false, force = true) {
            Object.keys(playingNodes).forEach(id => {
                if (immediate) {
                    try { playingNodes[id].source.stop(0); } catch (e) { } delete playingNodes[id];
                    const pad = document.getElementById(`pad-${id}`); pad.classList.remove('active', 'purifying'); pad.style.transition = "";
                } else { stopSample(id, force); }
            });
        }

        function attachEvents(pad) {
            let isTouch = false; const id = pad.dataset.id;
            const start = async (e) => {
                if (e.type === 'touchstart') {
                    isTouch = true;
                    if (e.cancelable) e.preventDefault();
                }
                if (e.type === 'mousedown' && isTouch) return;

                if (appMode !== 'PLAY') {
                    await processModeClick(id); return;
                }

                const started = triggerSample(id);
                if (started) {
                    const sampleData = SYSTEM_DATA.sets[currentSetKey].samples.find(s => s.id == id);
                    if (sampleData && sampleData.mode === 'gate') {
                        pad.dataset.purifyTimer = setTimeout(() => { if (pad.classList.contains('active') || isHoldMode) pad.classList.add('purifying'); }, 400);
                    }
                }
            };
            const end = (e) => {
                if (e.type === 'touchend' || e.type === 'touchcancel') {
                    if (e.cancelable) e.preventDefault();
                }
                if (e.type === 'mouseup' && isTouch) return;
                if (appMode !== 'PLAY') return;
                stopSample(id);
            };
            pad.addEventListener('mousedown', start); pad.addEventListener('touchstart', start, { passive: false });
            pad.addEventListener('mouseup', end); pad.addEventListener('mouseleave', end);
            pad.addEventListener('touchend', end, { passive: false }); pad.addEventListener('touchcancel', end, { passive: false });
        }

        function setupHoldButtons() {
            const btns = ['hold-btn-mobile', 'hold-btn-pc'];
            btns.forEach(id => {
                const btn = document.getElementById(id); if (!btn) return;
                btn.addEventListener('touchstart', (e) => { e.preventDefault(); toggleHoldMode(); }, { passive: false });
                btn.addEventListener('mousedown', (e) => { if (e.button === 0) toggleHoldMode(); });
            });
        }

        window.toggleHoldMode = function () {
            useStore.getState().toggleHoldMode();
            const currentMode = useStore.getState().isHoldMode;
            const b1 = document.getElementById('hold-btn-pc'); if (b1) currentMode ? b1.classList.add('active') : b1.classList.remove('active');
            const b2 = document.getElementById('hold-btn-mobile'); if (b2) currentMode ? b2.classList.add('active') : b2.classList.remove('active');
            // 【FIX】HOLD解除時はGATEサンプルのみ停止命令を送る (force引数をfalseに)
            if (!currentMode) stopAllSounds(false, false);
        };

        window.toggleFxMode = function () {
            useStore.getState().toggleFxMode();
            const currentFxMode = useStore.getState().isFxMode;
            const els = ['fx-btn-pc', 'fx-pad-pc', 'pc-fx-cursor', 'fx-btn-mobile', 'mobile-fx-zone', 'mobile-fx-cursor'];
            els.forEach(id => {
                const el = document.getElementById(id);
                if (el) currentFxMode ? el.classList.add('active') : el.classList.remove('active');
                if (id === 'mobile-fx-zone' && currentFxMode) el.classList.add('active-fx');
                if (id === 'mobile-fx-zone' && !currentFxMode) el.classList.remove('active-fx');
            });
        };

        window.addEventListener('keydown', e => {
            if (e.metaKey || e.ctrlKey || appMode !== 'PLAY') return;
            const k = e.key.toLowerCase();
            if (k === 'h') { toggleHoldMode(); return; }
            if (k === 'enter') { toggleFxMode(); return; }
            const pad = document.querySelector(`.pad[data-key="${k}"]`);
            if (pad && !pressedKeys.has(k)) { pressedKeys.add(k); pad.dispatchEvent(new Event('mousedown')); }
        });
        window.addEventListener('keyup', e => {
            const k = e.key.toLowerCase();
            const pad = document.querySelector(`.pad[data-key="${k}"]`);
            if (pad) { pressedKeys.delete(k); pad.dispatchEvent(new Event('mouseup')); }
        });

        function setupFx(zoneId, cursorId) {
            const zone = document.getElementById(zoneId); const cursor = document.getElementById(cursorId);
            if (!zone) return;
            const startFxInteraction = () => { if (!isFxMode) toggleFxMode(); };
            const move = (cx, cy) => {
                if (!isFxMode) return;
                const rect = zone.getBoundingClientRect();
                let x = (cx - rect.left) / rect.width; let y = (cy - rect.top) / rect.height;
                x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y));
                cursor.style.left = x * 100 + '%'; cursor.style.top = y * 100 + '%';
                cursor.classList.add('active'); updateFxParams(x, y);
            };

            let isPointerDown = false;
            zone.addEventListener('pointerdown', e => {
                isPointerDown = true; startFxInteraction(); zone.setPointerCapture(e.pointerId); move(e.clientX, e.clientY);
            });
            zone.addEventListener('pointermove', e => { if (isPointerDown) move(e.clientX, e.clientY); });
            zone.addEventListener('pointerup', e => { isPointerDown = false; zone.releasePointerCapture(e.pointerId); });
            zone.addEventListener('pointercancel', e => { isPointerDown = false; });
        }
        setupFx('mobile-fx-zone', 'mobile-fx-cursor'); setupFx('fx-pad-pc', 'pc-fx-cursor');

        function updateFxParams(x, y) {
            if (!masterFilterNode) return;
            const now = audioContext.currentTime;
            const freq = 100 * Math.pow(20000 / 100, 1.0 - y);
            masterFilterNode.frequency.setTargetAtTime(freq, now, 0.1);
            const wet = x;
            masterReverbGain.gain.setTargetAtTime(wet * 3.0, now, 0.1);
            masterDryGain.gain.setTargetAtTime(1.0 - (wet * 0.4), now, 0.1);
        }
