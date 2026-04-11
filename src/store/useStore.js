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
    })
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
