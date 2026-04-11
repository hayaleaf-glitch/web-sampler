import { useStore } from '../store/useStore.js';

export const AudioEngine = {
    context: null,
    buffers: new Array(16),
    playingNodes: {},
    masterFilterNode: null,
    masterReverbNode: null,
    masterReverbGain: null,
    masterDryGain: null,
    masterCompressor: null,
    isInitialized: false,
    stayAliveAudio: null,

    init() {
        if (this.isInitialized) return;
        this.isInitialized = true;
        const silentWav = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
        this.stayAliveAudio = new Audio(silentWav);
        this.stayAliveAudio.loop = true;
        this.stayAliveAudio.volume = 0.01;
        
        if ('audioSession' in navigator) { try { navigator.audioSession.type = 'playback'; } catch (e) { } }
        this.stayAliveAudio.play().catch(e => { console.log("Stay-alive audio blocked", e); });
        if ('mediaSession' in navigator) { navigator.mediaSession.playbackState = 'playing'; }
    },

    unlock(initContextCallback) {
        if (!this.context) {
            initContextCallback();
        }
        if (this.context && this.context.state === 'suspended') {
            this.context.resume();
        }
        if (!this.isInitialized) {
            this.init();
        }
    },

    setupMasterFX() {
        if (!this.context) return;
        this.masterFilterNode = this.context.createBiquadFilter();
        this.masterFilterNode.type = 'lowpass';
        this.masterFilterNode.frequency.value = 20000;
        this.masterFilterNode.Q.value = 1;

        this.masterReverbNode = this.context.createConvolver();
        this.masterReverbNode.buffer = this.createReverbBuffer(2.0);

        this.masterDryGain = this.context.createGain();
        this.masterDryGain.gain.value = 1.0;

        this.masterReverbGain = this.context.createGain();
        this.masterReverbGain.gain.value = 0.0;

        this.masterCompressor = this.context.createDynamicsCompressor();
        this.masterCompressor.threshold.value = -10;
        this.masterCompressor.knee.value = 30;
        this.masterCompressor.ratio.value = 12;
        this.masterCompressor.attack.value = 0.003;
        this.masterCompressor.release.value = 0.25;

        this.masterFilterNode.connect(this.masterDryGain);
        this.masterFilterNode.connect(this.masterReverbNode);
        this.masterReverbNode.connect(this.masterReverbGain);
        this.masterDryGain.connect(this.masterCompressor);
        this.masterReverbGain.connect(this.masterCompressor);
        this.masterCompressor.connect(this.context.destination);
    },

    createReverbBuffer(duration) {
        const sampleRate = this.context.sampleRate;
        const length = sampleRate * duration;
        const impulse = this.context.createBuffer(2, length, sampleRate);
        for (let i = 0; i < length; i++) {
            const decay = Math.pow(1 - i / length, 2.0);
            impulse.getChannelData(0)[i] = (Math.random() * 2 - 1) * decay;
            impulse.getChannelData(1)[i] = (Math.random() * 2 - 1) * decay;
        }
        return impulse;
    },

    updateFxParams(x, y) {
        if (!this.masterFilterNode) return;
        const now = this.context.currentTime;
        // Y = filter, X = reverb wet
        const freq = 100 * Math.pow(20000 / 100, 1.0 - y);
        this.masterFilterNode.frequency.setTargetAtTime(freq, now, 0.1);
        const wet = x;
        this.masterReverbGain.gain.setTargetAtTime(wet * 3.0, now, 0.1);
        this.masterDryGain.gain.setTargetAtTime(1.0 - (wet * 0.4), now, 0.1);
    },

    async preloadSingleSample(sample) {
        if (!sample || !sample.url || !this.context) return;
        try {
            const response = await fetch(sample.url);
            const buf = await response.arrayBuffer();
            this.buffers[sample.id] = await this.context.decodeAudioData(buf);
        } catch (e) { console.error("Audio Decode Error", e); }
    },

    async preloadAllSamples() {
        const state = useStore.getState();
        const currentSetData = state.systemData.sets[state.currentSetKey];
        if (!currentSetData || !this.context) return;
        const loadPromises = currentSetData.samples.map(async (sample) => {
            if (!sample || !sample.url) return;
            try {
                const response = await fetch(sample.url);
                const buf = await response.arrayBuffer();
                this.buffers[sample.id] = await this.context.decodeAudioData(buf);
            } catch (e) { }
        });
        await Promise.all(loadPromises);
    },

    triggerSample(id) {
        const state = useStore.getState();
        const sampleData = state.systemData.sets[state.currentSetKey].samples.find(s => s.id == id);
        const buffer = this.buffers[parseInt(id)];

        if (!buffer || !sampleData || !sampleData.url) return false;

        if (this.playingNodes[id]) {
            if (state.isHoldMode && sampleData.mode === 'gate') {
                this.stopSample(id, true); return false;
            } else {
                this.stopSample(id, true);
            }
        }

        const source = this.context.createBufferSource(); 
        source.buffer = buffer; 
        source.loop = sampleData.loop || false;
        
        const gainNode = this.context.createGain();
        source.connect(gainNode); 
        gainNode.connect(this.masterFilterNode || this.context.destination);
        
        const now = this.context.currentTime; 
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(1, now + (sampleData.fadeIn ? 0.05 : 0.005));
        
        let startOffset = 0; 
        if (sampleData.loop && sampleData.randomStart && buffer.duration > 1.0) {
            startOffset = Math.random() * 0.5;
        }
        source.start(0, startOffset);
        
        this.playingNodes[id] = { source: source, gain: gainNode, startTime: now, bufferDuration: buffer.duration };
        
        source.onended = () => {
            if (this.playingNodes[id] && this.playingNodes[id].source === source) { 
                delete this.playingNodes[id]; 
                const pad = document.getElementById(`pad-${id}`);
                if(pad) {
                    pad.classList.remove('active', 'purifying'); 
                    pad.style.transition = ""; 
                }
            }
        };
        return true;
    },

    stopSample(id, forceStop = false) {
        const node = this.playingNodes[id]; if (!node) return;
        const pad = document.getElementById(`pad-${id}`);
        const state = useStore.getState();
        const sampleData = state.systemData.sets[state.currentSetKey].samples.find(s => s.id == id);
        const now = this.context.currentTime;

        if (!forceStop) { 
            if (state.isHoldMode) return; 
            if (sampleData && sampleData.mode === 'oneshot') return; 
        }

        if(pad) {
            pad.classList.remove('active'); 
            clearTimeout(pad.dataset.purifyTimer);
        }
        
        let releaseTime = 0.3;
        const pressDuration = now - node.startTime;
        const isPurifying = pad ? pad.classList.contains('purifying') || pressDuration > 0.4 : false;
        
        if (isPurifying) { 
            releaseTime = 0.5 + Math.pow(pressDuration * 0.8, 1.2); 
            if (releaseTime > 20) releaseTime = 20; 
        }

        try { 
            node.gain.gain.cancelScheduledValues(now); 
            node.gain.gain.setValueAtTime(node.gain.gain.value, now); 
            node.gain.gain.exponentialRampToValueAtTime(0.001, now + releaseTime); 
            node.source.stop(now + releaseTime); 
        } catch (e) { }
        
        if(pad) {
            pad.classList.remove('purifying');
            if (isPurifying) pad.style.transition = `filter ${releaseTime}s cubic-bezier(0.1, 0.7, 0.1, 1), box-shadow ${releaseTime}s cubic-bezier(0.1, 0.7, 0.1, 1)`;
            else pad.style.transition = "";
        }
        delete this.playingNodes[id];
    },

    stopAllSounds(immediate = false, force = true) {
        Object.keys(this.playingNodes).forEach(id => {
            if (immediate) {
                try { this.playingNodes[id].source.stop(0); } catch (e) { } 
                delete this.playingNodes[id];
                const pad = document.getElementById(`pad-${id}`); 
                if(pad) {
                    pad.classList.remove('active', 'purifying'); 
                    pad.style.transition = "";
                }
            } else { 
                this.stopSample(id, force); 
            }
        });
    }
};
