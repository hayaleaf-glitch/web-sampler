import { useStore, subscribeToStore } from '../store/useStore.js';
import { AudioEngine } from '../audio/AudioEngine.js';

export const UIController = {
    keyMap: ['1', '2', '3', '4', 'q', 'w', 'e', 'r', 'a', 's', 'd', 'f', 'z', 'x', 'c', 'v'],
    pressedKeys: new Set(),
    isStandalone: false,
    isInAppBrowser: false,

    init() {
        this.isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
        const ua = navigator.userAgent || navigator.vendor || window.opera;
        this.isInAppBrowser = (ua.indexOf('FBAN') > -1) || (ua.indexOf('FBAV') > -1) || (ua.indexOf('Instagram') > -1) || (ua.indexOf('Line') > -1) || (ua.indexOf('Twitter') > -1);

        if (this.isInAppBrowser && !this.isStandalone) {
            document.getElementById('inapp-warning').style.display = 'flex';
        } else if (!localStorage.getItem('tutorialShown')) {
            setTimeout(() => this.openModal('main-menu-overlay'), 600);
        }

        if (this.isStandalone) { 
            document.getElementById('pwa-fab').style.display = 'none'; 
            document.getElementById('pwa-prompt').style.display = 'none'; 
        } else if (!this.isInAppBrowser) { 
            document.getElementById('pwa-fab').style.display = 'flex'; 
        }

        this.setupHoldButtons();
        this.setupFx('mobile-fx-zone', 'mobile-fx-cursor'); 
        this.setupFx('fx-pad-pc', 'pc-fx-cursor');
        this.setupKeyboardEvents();

        // Zustand Subscribe (状態変更時にUIを自動更新する)
        subscribeToStore(state => state.appMode, mode => {
            const wrapper = document.getElementById('sampler-wrapper');
            const banner = document.getElementById('mode-banner');
            const bannerText = document.getElementById('mode-banner-text');
            if(!wrapper || !banner) return;
            wrapper.className = ''; banner.className = '';
            
            if (mode === 'EDIT') { 
                wrapper.classList.add('mode-edit'); banner.classList.add('show', 'edit'); bannerText.innerText = 'EDIT: 編集するパッドをタップ'; 
            } else if (mode === 'SPOID') { 
                wrapper.classList.add('mode-spoid'); banner.classList.add('show', 'spoid'); bannerText.innerText = 'SPOID: コピーする音をタップ'; 
            } else if (mode === 'PASTE') { 
                wrapper.classList.add('mode-paste'); banner.classList.add('show', 'paste'); bannerText.innerText = 'PASTE: 上書きするパッドをタップ'; 
            }
        });

        subscribeToStore(state => state.isHoldMode, isHoldMode => {
            const b1 = document.getElementById('hold-btn-pc'); 
            if (b1) isHoldMode ? b1.classList.add('active') : b1.classList.remove('active');
            const b2 = document.getElementById('hold-btn-mobile'); 
            if (b2) isHoldMode ? b2.classList.add('active') : b2.classList.remove('active');
        });

        subscribeToStore(state => state.isFxMode, isFxMode => {
            const els = ['fx-btn-pc', 'fx-pad-pc', 'pc-fx-cursor', 'fx-btn-mobile', 'mobile-fx-zone', 'mobile-fx-cursor'];
            els.forEach(id => {
                const el = document.getElementById(id);
                if (el) isFxMode ? el.classList.add('active') : el.classList.remove('active');
                if (id === 'mobile-fx-zone' && isFxMode) el.classList.add('active-fx');
                if (id === 'mobile-fx-zone' && !isFxMode) el.classList.remove('active-fx');
            });
        });

        // ==========================================
        // Reactive Rendering (Zustand -> UI)
        // ==========================================
        subscribeToStore(state => state.systemData, () => {
            const currentSetKey = useStore.getState().currentSetKey;
            const systemData = useStore.getState().systemData;
            if (currentSetKey && systemData.sets[currentSetKey]) {
                this.renderPads(systemData.sets[currentSetKey]);
                // データが来たタイミングで確実に表示（フェードイン）
                const wrapper = document.getElementById('sampler-wrapper');
                if (wrapper) wrapper.style.opacity = '1';
            }
        });

        subscribeToStore(state => state.currentSetKey, (currentSetKey) => {
            const systemData = useStore.getState().systemData;
            if (currentSetKey && systemData.sets[currentSetKey]) {
                this.renderPads(systemData.sets[currentSetKey]);
                // セット変更時も確実に表示
                const wrapper = document.getElementById('sampler-wrapper');
                if (wrapper) wrapper.style.opacity = '1';
            }
        });

        // ==========================================
        // Audio Upload Event Binder
        // ==========================================
        const fileInput = document.getElementById('modal-file-input');
        if (fileInput) {
            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const uploadBtnLabel = document.getElementById('upload-btn-label');
                const originalText = uploadBtnLabel.innerHTML;
                uploadBtnLabel.innerHTML = '⚙️ Converting & Uploading...';
                uploadBtnLabel.style.pointerEvents = 'none';

                try {
                    const result = await useStore.getState().uploadAudioFile(file);
                    document.getElementById('modal-file-name').innerText = result.newFileName + " (Converted)";
                    document.getElementById('modal-edit-label').value = result.cleanName;
                } catch (error) {
                    alert(error.message);
                } finally {
                    uploadBtnLabel.innerHTML = originalText;
                    uploadBtnLabel.style.pointerEvents = 'auto';
                }
            });
        }
    },

    openModal(id) {
        const overlay = document.getElementById(id);
        if(!overlay) return;
        overlay.style.display = 'flex'; 
        setTimeout(() => overlay.classList.add('show'), 10);
        if (id === 'main-menu-overlay') localStorage.setItem('tutorialShown', 'true');
        this.toggleFxZoneInteraction(false);
    },

    closeModal(id) {
        const overlay = document.getElementById(id);
        if(!overlay) return;
        overlay.classList.remove('show'); 
        setTimeout(() => overlay.style.display = 'none', 300);
        if (!useStore.getState().isFeedOpen) this.toggleFxZoneInteraction(true);
    },

    toggleFxZoneInteraction(enable) {
        const fxZone = document.getElementById('mobile-fx-zone');
        if (fxZone) fxZone.style.pointerEvents = enable ? 'auto' : 'none';
    },

    togglePwaPrompt() { 
        document.getElementById('pwa-prompt').classList.toggle('show'); 
    },

    closePwaPrompt(e) { 
        e.stopPropagation(); 
        document.getElementById('pwa-prompt').classList.remove('show'); 
        localStorage.setItem('pwaPromptDismissed', 'true'); 
    },

    copyShareUrl() { 
        navigator.clipboard.writeText(window.location.href).then(() => { 
            const textSpan = document.getElementById('share-btn-text'); 
            const originalText = textSpan.innerText; 
            textSpan.innerText = "COPIED!"; 
            textSpan.style.color = "var(--success-color)"; 
            setTimeout(() => { textSpan.innerText = originalText; textSpan.style.color = "#fff"; }, 2000); 
        }); 
    },

    enterMode(mode) {
        useStore.getState().setAppMode(mode);
        this.closeModal('main-menu-overlay');
    },

    cancelMode() {
        useStore.getState().cancelMode();
    },

    toggleHoldMode() {
        useStore.getState().toggleHoldMode();
        if (!useStore.getState().isHoldMode) AudioEngine.stopAllSounds(false, false);
    },

    toggleFxMode() {
        useStore.getState().toggleFxMode();
    },

    renderPads(setData) {
        const container = document.getElementById('sampler-container'); 
        if(!container) return;
        container.innerHTML = '';
        for (let i = 0; i < 16; i++) {
            const sample = setData.samples.find(s => s.id === i) || { id: i, label: "" };
            const pad = document.createElement('div'); pad.className = 'pad'; pad.id = `pad-${i}`;
            pad.dataset.id = i; pad.dataset.key = this.keyMap[i];
            if (setData.image) {
                const col = i % 4; const row = Math.floor(i / 4);
                pad.style.backgroundImage = `url('${setData.image}')`;
                pad.style.backgroundPosition = `${col * (100 / 3)}% ${row * (100 / 3)}%`;
                pad.style.borderColor = "transparent";
            } else {
                // 画像がない場合でも場所がわかるように枠線をうっすら表示
                pad.style.border = "1px solid rgba(255,255,255,0.05)";
            }
            const label = document.createElement('span'); label.className = 'pad-label'; label.textContent = sample.label;
            pad.appendChild(label); 
            this.attachEvents(pad); 
            container.appendChild(pad);
        }
    },

    attachEvents(pad) {
        let isTouch = false; const id = pad.dataset.id;
        const start = async (e) => {
            if (e.type === 'touchstart') {
                isTouch = true;
                if (e.cancelable) e.preventDefault();
            }
            if (e.type === 'mousedown' && isTouch) return;

            const state = useStore.getState();
            if (state.appMode !== 'PLAY') {
                if(window.processModeClick) await window.processModeClick(id); 
                return;
            }

            const currentSetData = state.systemData.sets[state.currentSetKey];
            const sampleData = currentSetData ? currentSetData.samples.find(s => s.id == id) : null;
            
            if (!sampleData || !sampleData.url || !AudioEngine.buffers[parseInt(id)]) {
                const label = pad.querySelector('.pad-label');
                if (label) {
                    const origText = label.innerText;
                    label.innerText = "EMPTY"; label.style.color = "var(--danger-color)";
                    setTimeout(() => { label.innerText = origText; label.style.color = ""; }, 500);
                }
                return;
            }

            const started = AudioEngine.triggerSample(id);
            if (started) {
                clearTimeout(pad.dataset.purifyTimer);
                pad.classList.remove('purifying');
                pad.style.transition = "";
                void pad.offsetWidth;
                pad.classList.add('active');

                if (sampleData && sampleData.mode === 'gate') {
                    pad.dataset.purifyTimer = setTimeout(() => { 
                        if (pad.classList.contains('active') || useStore.getState().isHoldMode) {
                            pad.classList.add('purifying'); 
                        }
                    }, 400);
                }
            }
        };
        const end = (e) => {
            if (e.type === 'touchend' || e.type === 'touchcancel') {
                if (e.cancelable) e.preventDefault();
            }
            if (e.type === 'mouseup' && isTouch) return;
            if (useStore.getState().appMode !== 'PLAY') return;
            AudioEngine.stopSample(id);
        };
        pad.addEventListener('mousedown', start); pad.addEventListener('touchstart', start, { passive: false });
        pad.addEventListener('mouseup', end); pad.addEventListener('mouseleave', end);
        pad.addEventListener('touchend', end, { passive: false }); pad.addEventListener('touchcancel', end, { passive: false });
    },

    setupHoldButtons() {
        const btns = ['hold-btn-mobile', 'hold-btn-pc'];
        btns.forEach(id => {
            const btn = document.getElementById(id); if (!btn) return;
            btn.addEventListener('touchstart', (e) => { e.preventDefault(); this.toggleHoldMode(); }, { passive: false });
            btn.addEventListener('mousedown', (e) => { if (e.button === 0) this.toggleHoldMode(); });
        });
    },

    setupFx(zoneId, cursorId) {
        const zone = document.getElementById(zoneId); const cursor = document.getElementById(cursorId);
        if (!zone) return;
        const startFxInteraction = () => { if (!useStore.getState().isFxMode) this.toggleFxMode(); };
        const move = (cx, cy) => {
            if (!useStore.getState().isFxMode) return;
            const rect = zone.getBoundingClientRect();
            let x = (cx - rect.left) / rect.width; let y = (cy - rect.top) / rect.height;
            x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y));
            cursor.style.left = x * 100 + '%'; cursor.style.top = y * 100 + '%';
            cursor.classList.add('active'); AudioEngine.updateFxParams(x, y);
        };

        let isPointerDown = false;
        zone.addEventListener('pointerdown', e => {
            isPointerDown = true; startFxInteraction(); zone.setPointerCapture(e.pointerId); move(e.clientX, e.clientY);
        });
        zone.addEventListener('pointermove', e => { if (isPointerDown) move(e.clientX, e.clientY); });
        zone.addEventListener('pointerup', e => { isPointerDown = false; zone.releasePointerCapture(e.pointerId); });
        zone.addEventListener('pointercancel', e => { isPointerDown = false; });
    },

    setupKeyboardEvents() {
        window.addEventListener('keydown', e => {
            const state = useStore.getState();
            if (e.metaKey || e.ctrlKey || state.appMode !== 'PLAY') return;
            const k = e.key.toLowerCase();
            if (k === 'h') { this.toggleHoldMode(); return; }
            if (k === 'enter') { this.toggleFxMode(); return; }
            const pad = document.querySelector(`.pad[data-key="${k}"]`);
            if (pad && !this.pressedKeys.has(k)) { 
                this.pressedKeys.add(k); 
                pad.dispatchEvent(new Event('mousedown')); 
            }
        });
        window.addEventListener('keyup', e => {
            const k = e.key.toLowerCase();
            const pad = document.querySelector(`.pad[data-key="${k}"]`);
            if (pad) { 
                this.pressedKeys.delete(k); 
                pad.dispatchEvent(new Event('mouseup')); 
            }
        });
    },

    renderDynamicMenu() {
        const container = document.getElementById('dynamic-menu-container');
        const profileInfo = document.getElementById('user-profile-info');
        if(!container) return;
        container.innerHTML = '<h3>MENU</h3>';

        const state = useStore.getState();
        const currentUser = state.currentUser;
        const currentSetData = state.systemData.sets[state.currentSetKey];
        const isMySet = currentUser && currentSetData && currentSetData.ownerId === currentUser.uid;

        if (currentUser) {
            profileInfo.innerText = `Logged in as: ${currentUser.email}`;
        } else {
            if(profileInfo) profileInfo.innerText = '';
            container.innerHTML += `
                <div class="modal-menu-item google-login" onclick="window.handleGoogleLogin()"><span style="color:#4285F4;">G</span> Login with Google</div>
                <div class="modal-menu-item disabled" onclick="alert('ログインすると、自分の音を追加したり編集できるようになります。')"><span>🔒 音を追加・編集 (Lite Edit)</span></div>
                <div class="modal-menu-item disabled" onclick="alert('ログインすると、他人の音を自分のセットにコピーできるようになります。')"><span>🔒 このセットをコピー (Resample)</span></div>
            `;
        }

        if (isMySet) {
            container.innerHTML += `<div class="modal-menu-item" onclick="window.enterMode('EDIT')"><span>音を追加・編集 (Lite Edit)</span><span class="icon">▶</span></div>`;
        } else if (currentUser && currentSetData) {
            container.innerHTML += `<div class="modal-menu-item pro" onclick="window.enterMode('SPOID')"><span>このセットから音をコピー (Resample)</span><span class="icon">▶</span></div>`;
        }

        container.innerHTML += `
            <div class="modal-menu-item" onclick="window.copyShareUrl()"><span id="share-btn-text">この音をシェア (Share)</span><span class="icon">▶</span></div>
            <a href="./editor_v4.html" target="_blank" rel="noopener noreferrer" class="modal-menu-item pro"><span>高度な編集 (Studio Proへ)</span><span class="icon">↗</span></a>
        `;
        if (currentUser) { 
            container.innerHTML += `<div class="modal-menu-item danger" onclick="window.handleGoogleLogout()" style="margin-top:20px;"><span>ログアウト</span><span class="icon">▶</span></div>`; 
        }
    },

    switchFeed(feedType) {
        const overlay = document.getElementById('feed-overlay');
        const tabs = document.querySelectorAll('.feed-tab');
        const targetTab = Array.from(tabs).find(t => t.innerText.toLowerCase() === feedType);

        if (targetTab && targetTab.classList.contains('active') && useStore.getState().isFeedOpen) {
            overlay.classList.remove('show'); 
            useStore.getState().setFeedOpen(false); 
            this.toggleFxZoneInteraction(true); 
            return;
        }
        tabs.forEach(el => el.classList.remove('active'));
        if (targetTab) targetTab.classList.add('active');

        if (feedType === 'main') { 
            this.renderFeedList(); 
            overlay.classList.add('show'); 
            useStore.getState().setFeedOpen(true); 
            this.toggleFxZoneInteraction(false); 
        } else { 
            overlay.innerHTML = `<div style="padding:40px 20px; color:#888; text-align:center; font-weight:300;">${feedType.toUpperCase()} feed coming in Phase 2.2</div>`; 
            overlay.classList.add('show'); 
            useStore.getState().setFeedOpen(true); 
            this.toggleFxZoneInteraction(false); 
        }
    },

    renderFeedList() {
        const container = document.getElementById('feed-overlay');
        const state = useStore.getState();
        container.innerHTML = '';
        Object.keys(state.systemData.sets).forEach(key => {
            const s = state.systemData.sets[key];
            const el = document.createElement('div');
            el.className = `feed-list-item ${key === state.currentSetKey ? 'active' : ''}`;
            const mainBadge = s.isMain ? `<span class="badge-main">MAIN</span>` : '';
            el.innerHTML = `<div class="feed-list-title">${s.name} ${mainBadge}</div><div class="feed-list-sub">by ${s.recorder || 'Unknown'}</div>`;
            el.onclick = () => { 
                if(window.changeSamplerSet) window.changeSamplerSet(key); 
                document.getElementById('feed-overlay').classList.remove('show'); 
                useStore.getState().setFeedOpen(false); 
                this.toggleFxZoneInteraction(true); 
            };
            container.appendChild(el);
        });
    },

    renderMySetsFeed() {
        const container = document.getElementById('feed-overlay');
        const state = useStore.getState();
        container.innerHTML = '<div style="padding: 20px; color:#00ffaa; font-weight:bold; letter-spacing:0.1em; border-bottom: 1px solid #333;">ペースト先のセットを選択</div>';
        Object.keys(state.systemData.sets).forEach(key => {
            const s = state.systemData.sets[key];
            if (state.currentUser && s.ownerId === state.currentUser.uid) {
                const el = document.createElement('div'); 
                el.className = `feed-list-item`;
                const mainBadge = s.isMain ? `<span class="badge-main">MAIN</span>` : '';
                el.innerHTML = `<div class="feed-list-title">${s.name} ${mainBadge}</div>`;
                el.onclick = async () => {
                    document.getElementById('feed-overlay').classList.remove('show'); 
                    useStore.getState().setFeedOpen(false); 
                    this.toggleFxZoneInteraction(true);
                    if(window.changeSamplerSet) await window.changeSamplerSet(key);
                    this.enterMode('PASTE');
                };
                container.appendChild(el);
            }
        });
    },

    // ==========================================
    // ACTION CONTROLLERS (Dispatch to Zustand)
    // ==========================================
    async processModeClick(id) {
        const state = useStore.getState();
        const mode = state.appMode;
        
        if (mode === 'EDIT') {
            this.openPadEditModal(id);
            return true;
        }

        if (mode === 'SPOID') {
            const currentSetData = state.systemData.sets[state.currentSetKey];
            const sampleData = currentSetData.samples.find(s => s.id == id);
            if (!sampleData || !sampleData.url) { 
                alert("このパッドには音がありません。"); 
                return true; 
            }
            const newData = JSON.parse(JSON.stringify(sampleData));
            useStore.getState().setSpoidData(newData);
            AudioEngine.triggerSample(id);
            alert("音をコピーしました。\nペースト先の自分のセットを選択してください。");
            this.renderMySetsFeed();
            document.getElementById('feed-overlay').classList.add('show');
            useStore.getState().setFeedOpen(true);
            this.toggleFxZoneInteraction(false);
            return true;
        }

        if (mode === 'PASTE') {
            const spoided = state.spoidedSampleData;
            if (!spoided) { 
                useStore.getState().cancelMode();
                return true; 
            }
            if (confirm(`このパッドに音を上書きペーストしますか？`)) {
                document.getElementById('loading-indicator').style.display = 'block';
                document.getElementById('loading-indicator').innerText = 'UPDATING DATABASE...';
                try {
                    await useStore.getState().pasteSpoidData(id);
                } catch (e) { 
                    alert("エラーが発生しました: " + e.message); 
                } finally { 
                    document.getElementById('loading-indicator').style.display = 'none'; 
                }
            }
            return true;
        }

        return false;
    },

    openPadEditModal(id) {
        const state = useStore.getState();
        const currentSetData = state.systemData.sets[state.currentSetKey];
        const sample = currentSetData.samples.find(s => s.id == id) || { id: parseInt(id), mode: 'gate', loop: false, url: "", label: "" };

        const tempEditingSample = JSON.parse(JSON.stringify(sample));
        state.setEditTarget(parseInt(id), tempEditingSample);

        document.getElementById('modal-edit-title').innerText = `EDIT PAD ${id}`;
        document.getElementById('modal-edit-label').value = tempEditingSample.label || '';
        document.getElementById('modal-edit-mode').value = tempEditingSample.mode || 'gate';
        document.getElementById('modal-edit-loop').checked = !!tempEditingSample.loop;
        document.getElementById('modal-edit-fadeIn').checked = !!tempEditingSample.fadeIn;
        document.getElementById('modal-edit-random').checked = !!tempEditingSample.randomStart;

        document.getElementById('modal-file-name').innerText = tempEditingSample.url ? "✅ 音源設定済み" : "No file selected";
        document.getElementById('modal-file-input').value = '';
        
        this.openModal('pad-edit-overlay');
    },

    async savePadEdit() {
        const state = useStore.getState();
        if (!state.tempEditingSample) return;

        // UIから最新の設定を取得してStateを更新
        state.tempEditingSample.label = document.getElementById('modal-edit-label').value;
        state.tempEditingSample.mode = document.getElementById('modal-edit-mode').value;
        state.tempEditingSample.loop = document.getElementById('modal-edit-loop').checked;
        state.tempEditingSample.fadeIn = document.getElementById('modal-edit-fadeIn').checked;
        state.tempEditingSample.randomStart = document.getElementById('modal-edit-random').checked;

        document.getElementById('loading-indicator').style.display = 'block';
        document.getElementById('loading-indicator').innerText = 'SAVING PAD...';

        try {
            await state.savePadEdit(); // Audio/UI更新はStore内でsubscribeによって行われる。
            // ※ ただし、ZustandのsubscribeがrenderPadsを呼ぶためUI更新の命令呼び出しは不要になった！
        } catch (error) { 
            alert("保存エラー: " + error.message); 
        } finally { 
            document.getElementById('loading-indicator').style.display = 'none'; 
        }
    },

    async clearPadEdit() {
        if (!confirm("このパッドの音源を消去しますか？")) return;
        document.getElementById('loading-indicator').style.display = 'block';
        try {
            await useStore.getState().clearPadEdit();
        } catch (e) {
            console.error(e);
        } finally {
            document.getElementById('loading-indicator').style.display = 'none'; 
        }
    }
};
