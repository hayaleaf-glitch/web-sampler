import { createStore } from 'zustand/vanilla';

// Zustandストアの作成
export const useStore = createStore((set, get) => ({
    // -------------------------
    // 1. User & DB State
    // -------------------------
    currentUser: null,
    systemData: { sets: {} },
    currentSetKey: null,

    setCurrentUser: (user) => set({ currentUser: user }),
    setSystemData: (data) => set({ systemData: data }),
    setCurrentSetKey: (key) => set({ currentSetKey: key }),

    // -------------------------
    // 2. App Mode State
    // -------------------------
    appMode: 'PLAY', // 'PLAY' | 'EDIT' | 'SPOID' | 'PASTE'
    isHoldMode: false,
    isFxMode: false,
    isFeedOpen: false,

    setAppMode: (mode) => set({ appMode: mode }),
    toggleHoldMode: () => set((state) => ({ isHoldMode: !state.isHoldMode })),
    toggleFxMode: () => set((state) => ({ isFxMode: !state.isFxMode })),
    setFeedOpen: (isOpen) => set({ isFeedOpen: isOpen }),

    // -------------------------
    // 3. Edit & Modal State
    // -------------------------
    targetEditPadId: null,
    spoidedSampleData: null,
    tempEditingSample: null,

    setEditTarget: (padId, tempSample) => set({ targetEditPadId: padId, tempEditingSample: tempSample }),
    setSpoidData: (data) => set({ spoidedSampleData: data }),
    cancelMode: () => set({ 
        appMode: 'PLAY', 
        targetEditPadId: null, 
        spoidedSampleData: null, 
        tempEditingSample: null 
    }),

    // -------------------------
    // 4. Async Actions (Thunks)
    // -------------------------
    fetchAppInitialData: async (targetUserId = null) => {
        const { FirebaseManager } = await import('../firebase/FirebaseManager.js');
        const res = await FirebaseManager.loadAllSets(targetUserId);
        
        set({ systemData: { sets: res.data } });
        
        const targetSetId = new URLSearchParams(window.location.search).get('set');
        let nextSetId = targetSetId || res.mainSetId || res.defaultSetId;

        if (nextSetId) {
            get().changeSamplerSet(nextSetId);
        }
    },

    changeSamplerSet: async (setKey) => {
        set({ currentSetKey: setKey });
        
        const { AudioEngine } = await import('../audio/AudioEngine.js');
        AudioEngine.unlock(() => {
            AudioEngine.context = new (window.AudioContext || window.webkitAudioContext)();
            AudioEngine.setupMasterFX();
        });
        AudioEngine.stopAllSounds(true, true);
        await AudioEngine.preloadAllSamples();
    },

    savePadEdit: async () => {
        const state = get();
        if (!state.tempEditingSample || !state.currentSetKey) return;
        
        const { FirebaseManager } = await import('../firebase/FirebaseManager.js');
        const { AudioEngine } = await import('../audio/AudioEngine.js');

        const setId = state.currentSetKey;
        const padId = state.targetEditPadId;
        const temp = state.tempEditingSample;

        const currentSetData = state.systemData.sets[setId];
        const newSamples = [...currentSetData.samples];
        const index = newSamples.findIndex(s => s.id == padId);
        if (index !== -1) newSamples[index] = temp; else newSamples.push(temp);

        await FirebaseManager.updateSetSamples(setId, newSamples);

        set(s => {
            const nextData = JSON.parse(JSON.stringify(s.systemData));
            nextData.sets[setId].samples = newSamples;
            return { systemData: nextData };
        });

        await AudioEngine.preloadSingleSample(temp);
        get().cancelMode();
    },

    clearPadEdit: async () => {
        const state = get();
        if (!state.tempEditingSample) return;
        set(s => {
            const temp = {...s.tempEditingSample, url: "", label: ""};
            return { tempEditingSample: temp };
        });
        await get().savePadEdit();
    },

    pasteSpoidData: async (targetId) => {
        const state = get();
        const spoided = state.spoidedSampleData;
        if (!spoided || !state.currentSetKey) {
            get().cancelMode();
            return;
        }

        const { FirebaseManager } = await import('../firebase/FirebaseManager.js');
        const { AudioEngine } = await import('../audio/AudioEngine.js');
        
        const setId = state.currentSetKey;
        const currentSetData = state.systemData.sets[setId];
        const newSamples = [...currentSetData.samples];
        const index = newSamples.findIndex(s => s.id == targetId);
        
        const newData = JSON.parse(JSON.stringify(spoided));
        newData.id = parseInt(targetId);
        
        if (index !== -1) newSamples[index] = newData; else newSamples.push(newData);

        await FirebaseManager.updateSetSamples(setId, newSamples);

        set(s => {
            const nextData = JSON.parse(JSON.stringify(s.systemData));
            nextData.sets[setId].samples = newSamples;
            return { systemData: nextData };
        });

        await AudioEngine.preloadSingleSample(newData);
        get().cancelMode();
    },

    uploadAudioFile: async (file) => {
        const state = get();
        if (!file || !state.targetEditPadId || !state.currentUser || !state.currentSetKey) {
            throw new Error("Upload aborted: Missing required state parameters.");
        }
        
        const { FirebaseManager } = await import('../firebase/FirebaseManager.js');
        const { AudioEngine } = await import('../audio/AudioEngine.js');

        const mp3Blob = await AudioEngine.convertToMP3Blob(file);
        const originalNameBase = file.name.replace(/\.[^/.]+$/, "");
        const newFileName = `${originalNameBase}.mp3`;

        const downloadURL = await FirebaseManager.uploadAudioFile(
            state.currentUser.uid, 
            state.currentSetKey, 
            mp3Blob, 
            newFileName
        );
        
        const cleanName = originalNameBase.substring(0, 15);

        set(s => {
            const temp = { ...s.tempEditingSample };
            temp.url = downloadURL;
            temp.label = cleanName;
            return { tempEditingSample: temp };
        });

        return { newFileName, cleanName };
    }
}));

// Storeの購読（Subscribe）用ヘルパー関数
export function subscribeToStore(selector, callback) {
    let currentState = selector(useStore.getState());
    return useStore.subscribe((state) => {
        const nextState = selector(state);
        if (nextState !== currentState) {
            currentState = nextState;
            callback(currentState);
        }
    });
}
