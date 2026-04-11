import { useStore } from './store/useStore.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { UIController } from './ui/UIController.js';
import { FirebaseManager } from './firebase/FirebaseManager.js';

window.addEventListener('contextmenu', e => e.preventDefault(), { passive: false });

const handleMasterUnlock = () => {
    AudioEngine.unlock(() => {
        try {
            AudioEngine.context = new (window.AudioContext || window.webkitAudioContext)();
            AudioEngine.setupMasterFX();
        } catch (e) { console.error("Audio unlock failed", e); }
    });
};

['touchstart', 'touchend', 'mousedown', 'click'].forEach(evt => {
    document.addEventListener(evt, handleMasterUnlock, { capture: true, passive: true });
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (AudioEngine.context) {
            let lastTime = AudioEngine.context.currentTime;
            setTimeout(() => {
                if (AudioEngine.context.currentTime === lastTime) {
                    console.log("AudioContext Zombie detected! Rebuilding...");
                    AudioEngine.context.close().then(() => {
                        AudioEngine.context = new (window.AudioContext || window.webkitAudioContext)();
                        AudioEngine.setupMasterFX();
                        AudioEngine.preloadAllSamples();
                    });
                } else if (AudioEngine.context.state === 'suspended') {
                    AudioEngine.context.resume();
                }
            }, 50);
        }
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    }
});

// ==========================================
// グローバル空間へのバインド (HTML内の onclick 等で呼び出されるため)
// ==========================================
window.enterMode = UIController.enterMode.bind(UIController);
window.cancelMode = UIController.cancelMode.bind(UIController);
window.openModal = UIController.openModal.bind(UIController);
window.closeModal = UIController.closeModal.bind(UIController);
window.copyShareUrl = UIController.copyShareUrl.bind(UIController);
window.togglePwaPrompt = UIController.togglePwaPrompt.bind(UIController);
window.closePwaPrompt = UIController.closePwaPrompt.bind(UIController);
window.switchFeed = UIController.switchFeed.bind(UIController);
window.toggleFxMode = UIController.toggleFxMode.bind(UIController);

// モードクリック、PADの保存関連もUIControllerへ移譲
window.processModeClick = UIController.processModeClick.bind(UIController);
window.savePadEdit = UIController.savePadEdit.bind(UIController);
window.clearPadEdit = UIController.clearPadEdit.bind(UIController);

// Googleログイン等はFirebaseManagerを叩くラッパー
window.handleGoogleLogin = async function() {
    try {
        await FirebaseManager.login();
    } catch(err) {
        alert("Login Failed: " + err.message);
    }
};

window.handleGoogleLogout = async function() {
    try {
        await FirebaseManager.logout();
        alert("ログアウトしました");
        UIController.closeModal('main-menu-overlay');
        UIController.cancelMode();
    } catch(err) {
        console.error(err);
    }
};

// ==========================================
// Boot Flow (アプリケーションの起動)
// ==========================================
window.addEventListener('DOMContentLoaded', async () => { 
    // 1. 認証リスナーの設定 (Zustandへ結果を流し込む)
    FirebaseManager.init((user) => {
        useStore.getState().setCurrentUser(user);
        UIController.renderDynamicMenu();
    });

    // 2. UIの初期設定とZustandへのSubscribe設定
    UIController.init();

    // 3. データフェッチ(Storeハブを通して初期化)
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const targetUserId = urlParams.get('u');
        await useStore.getState().fetchAppInitialData(targetUserId);
    } catch(e) {
        console.error(e);
    } finally {
        document.getElementById('loading-indicator').style.display = 'none';
        UIController.renderDynamicMenu();
    }
});
