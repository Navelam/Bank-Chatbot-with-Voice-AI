// BankBot Class - Complete Functional Chatbot (Backend TTS Always for Tamil)
class BankBot {
    constructor() {
        this.currentLanguage = 'en';
        this.recognition = null;
        this.isProcessing = false;
        this.isMinimized = false;
        this.isMaximized = false;
        this.voicesLoaded = false;
        this.speakTimeout = null;
        this.availableVoices = [];
        this.maleVoice = null;
        this.femaleVoice = null;
        this.audio = null;
        this.userInteracted = false;
        this.speechQueue = [];
        this.isSpeaking = false;
        this.isProcessingQueue = false;
        this.voiceType = 'male';
        this.speechRate = 0.9;
        this.pendingVoiceText = null;
        this.sendMessageDebounce = null;
        this.ttsAbortController = null;
        this.DEBOUNCE_DELAY = 300;
        this.init();
    }
    
    init() {
        this.initSpeechRecognition();
        this.loadVoices();
        this.loadChatHistory();
        this.attachEventListeners();
        this.setupChatIcon();
        this.setupUserInteraction();
        console.log('BankBot initialized successfully');
    }
    
    setupUserInteraction() {
        const unlockAudio = () => {
            if (!this.userInteracted) {
                this.userInteracted = true;
                console.log('User interaction detected - Audio unlocked');
                const silentAudio = new Audio();
                silentAudio.play().then(() => {
                    console.log('Audio context unlocked');
                }).catch(() => {});
            }
        };
        
        document.addEventListener('click', unlockAudio);
        document.addEventListener('touchstart', unlockAudio);
        document.addEventListener('keydown', unlockAudio);
    }
    
    loadVoices() {
        if ('speechSynthesis' in window) {
            const loadVoiceList = () => {
                this.availableVoices = window.speechSynthesis.getVoices();
                this.voicesLoaded = true;
                
                console.log('Available Voices:', this.availableVoices.map(v => `${v.name} (${v.lang})`));
                
                const tamilVoiceExists = this.availableVoices.some(v => 
                    v.lang === 'ta-IN' || v.name.includes('Tamil')
                );
                console.log('Tamil voice available in browser:', tamilVoiceExists ? 'YES' : 'NO');
                
                this.maleVoice = this.availableVoices.find(voice => 
                    voice.name === 'Google UK English Male' || 
                    voice.name === 'Microsoft Mark' ||
                    voice.name === 'Google US English' ||
                    voice.name.includes('Male')
                );
                
                this.femaleVoice = this.availableVoices.find(voice => 
                    voice.name === 'Google UK English Female' ||
                    voice.name === 'Microsoft Zira' ||
                    voice.name.includes('Female')
                );
                
                console.log('English Male Voice:', this.maleVoice?.name || 'Default');
                console.log('English Female Voice:', this.femaleVoice?.name || 'Default');
            };
            
            loadVoiceList();
            
            if (window.speechSynthesis.onvoiceschanged !== undefined) {
                window.speechSynthesis.onvoiceschanged = loadVoiceList;
            }
        }
    }
    
    initSpeechRecognition() {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = false;
            this.recognition.interimResults = true;
            this.recognition.maxAlternatives = 1;
            return true;
        }
        return false;
    }
    
    async speakTamil(text) {
        if (!text || text.trim() === '') {
            return Promise.resolve();
        }
        
        if (!this.userInteracted) {
            console.warn("User interaction required for audio playback");
            this.addMessage('Click anywhere to enable voice output', 'bot');
            return Promise.resolve();
        }
        
        this.showSpeakingIndicator();
        console.log("Generating Tamil audio via backend");
        
        this.ttsAbortController = new AbortController();
        
        try {
            const response = await fetch('/api/tts-ta', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text }),
                signal: this.ttsAbortController.signal
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'TTS server error: ' + response.status);
            }
            
            const blob = await response.blob();
            const audioUrl = URL.createObjectURL(blob);
            
            if (this.audio) {
                this.audio.pause();
                this.audio = null;
            }
            
            this.audio = new Audio(audioUrl);
            
            return new Promise((resolve, reject) => {
                this.audio.onended = () => {
                    URL.revokeObjectURL(audioUrl);
                    this.audio = null;
                    this.hideSpeakingIndicator();
                    console.log('Tamil speech completed');
                    resolve();
                };
                
                this.audio.onerror = (err) => {
                    URL.revokeObjectURL(audioUrl);
                    this.audio = null;
                    this.hideSpeakingIndicator();
                    console.error('Audio playback error:', err);
                    this.addMessage('Tamil voice generation failed. Please try again.', 'bot');
                    reject(err);
                };
                
                this.audio.play().catch(err => {
                    URL.revokeObjectURL(audioUrl);
                    this.audio = null;
                    this.hideSpeakingIndicator();
                    console.warn("Autoplay blocked:", err);
                    this.addMessage('Please click again to hear the response', 'bot');
                    reject(err);
                });
            });
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('Tamil TTS request aborted');
                this.hideSpeakingIndicator();
                return Promise.resolve();
            }
            console.error('Tamil TTS Error:', err);
            this.hideSpeakingIndicator();
            this.addMessage('Sorry, voice service is temporarily unavailable', 'bot');
            return Promise.resolve();
        } finally {
            this.ttsAbortController = null;
        }
    }
    
    async speakEnglish(text) {
        if (!text || text.trim() === '') return Promise.resolve();
        
        await new Promise(r => setTimeout(r, 100));
        
        return new Promise((resolve) => {
            window.speechSynthesis.cancel();
            
            const utterance = new SpeechSynthesisUtterance(text);
            
            if (this.voiceType === 'male' && this.maleVoice) {
                utterance.voice = this.maleVoice;
                utterance.lang = 'en-GB';
            } else if (this.voiceType === 'female' && this.femaleVoice) {
                utterance.voice = this.femaleVoice;
                utterance.lang = 'en-GB';
            } else if (this.maleVoice) {
                utterance.voice = this.maleVoice;
                utterance.lang = 'en-GB';
            } else {
                utterance.lang = 'en-US';
            }
            
            utterance.rate = this.speechRate;
            utterance.pitch = this.voiceType === 'female' ? 1.1 : 0.9;
            utterance.volume = 1.0;
            
            utterance.onend = () => {
                console.log('English speech completed');
                resolve();
            };
            
            utterance.onerror = (event) => {
                console.error('English speech error:', event);
                resolve();
            };
            
            window.speechSynthesis.speak(utterance);
        });
    }
    
    async speakText(text) {
        if (!text || text.trim() === '') return;
        
        this.speechQueue.push(text);
        
        if (!this.isProcessingQueue) {
            this.processQueue();
        }
    }
    
    async processQueue() {
        if (this.isProcessingQueue) return;
        
        this.isProcessingQueue = true;
        
        while (this.speechQueue.length > 0) {
            this.isSpeaking = true;
            const text = this.speechQueue.shift();
            
            if (this.audio) {
                this.audio.pause();
                this.audio = null;
            }
            
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
            }
            
            if (this.speakTimeout) {
                clearTimeout(this.speakTimeout);
            }
            
            try {
                if (this.currentLanguage === 'ta') {
                    await this.speakTamil(text);
                } else {
                    await this.speakEnglish(text);
                }
            } catch (err) {
                // One item failed — log and continue draining the queue
                console.warn('Speech item failed, continuing queue:', err);
            }
        }
        
        this.isSpeaking = false;
        this.isProcessingQueue = false;
    }
    
    showSpeakingIndicator() {
        const indicator = document.getElementById('speakingIndicator');
        if (indicator) {
            indicator.style.display = 'flex';
        } else {
            const messagesContainer = document.getElementById('chatbotBody');
            if (messagesContainer) {
                const speakingDiv = document.createElement('div');
                speakingDiv.id = 'speakingIndicator';
                speakingDiv.className = 'speaking-indicator';
                speakingDiv.innerHTML = '<span>Speaking...</span>';
                messagesContainer.appendChild(speakingDiv);
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        }
    }
    
    hideSpeakingIndicator() {
        const indicator = document.getElementById('speakingIndicator');
        if (indicator) {
            indicator.remove();
        }
    }
    
    async sendMessage() {
        if (this.isProcessing) return;
        
        if (this.sendMessageDebounce) {
            clearTimeout(this.sendMessageDebounce);
        }
        
        this.sendMessageDebounce = setTimeout(async () => {
            const input = document.getElementById('chatbotInput');
            if (!input) return;
            
            const message = input.value.trim();
            if (!message) return;
            
            input.value = '';
            
            this.isProcessing = true;
            this.addMessage(message, 'user');
            
            const sendBtn = document.getElementById('sendBtn');
            const micBtn = document.getElementById('micBtn');
            if (sendBtn) {
                sendBtn.disabled = true;
                sendBtn.style.opacity = '0.5';
            }
            if (micBtn) micBtn.disabled = true;
            
            this.showTypingIndicator();
            
            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: message,
                        language: this.currentLanguage
                    })
                });
                
                if (!response.ok) throw new Error('Network response was not ok');
                
                const data = await response.json();
                this.removeTypingIndicator();
                this.addMessage(data.response, 'bot');
                
                setTimeout(() => {
                    this.speakText(data.response);
                }, 150);
                
            } catch (error) {
                console.error('Error:', error);
                this.removeTypingIndicator();
                const errorMsg = this.currentLanguage === 'ta' 
                    ? 'மன்னிக்கவும், பிழை ஏற்பட்டது. தயவுசெய்து மீண்டும் முயற்சி செய்யவும்'
                    : 'Sorry, there was an error. Please try again';
                this.addMessage(errorMsg, 'bot');
                this.speakText(errorMsg);
            } finally {
                this.isProcessing = false;
                if (sendBtn) {
                    sendBtn.disabled = false;
                    sendBtn.style.opacity = '1';
                }
                if (micBtn) micBtn.disabled = false;
                input.focus();
            }
        }, this.DEBOUNCE_DELAY);
    }
    
    addMessage(text, sender) {
        const messagesContainer = document.getElementById('chatbotBody');
        if (!messagesContainer) return;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        
        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.textContent = sender === 'user' ? 'U' : 'B';
        
        const content = document.createElement('div');
        content.className = 'message-content';
        
        const messageText = document.createElement('div');
        messageText.className = 'message-text';
        messageText.textContent = text;
        
        const time = document.createElement('div');
        time.className = 'message-time';
        time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        content.appendChild(messageText);
        content.appendChild(time);
        messageDiv.appendChild(avatar);
        messageDiv.appendChild(content);
        
        messageDiv.style.cursor = 'pointer';
        messageDiv.addEventListener('click', () => this.speakText(text));
        
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        messagesContainer.scrollTo({
            top: messagesContainer.scrollHeight,
            behavior: 'smooth'
        });
    }
    
    showTypingIndicator() {
        const messagesContainer = document.getElementById('chatbotBody');
        if (!messagesContainer) return;
        
        this.removeTypingIndicator();
        
        const typingDiv = document.createElement('div');
        typingDiv.id = 'typingIndicator';
        typingDiv.className = 'message bot';
        typingDiv.innerHTML = `
            <div class="message-avatar">B</div>
            <div class="message-content">
                <div class="message-text">
                    ${this.currentLanguage === 'ta' ? 'தட்டச்சு செய்கிறது' : 'Typing'}...
                </div>
            </div>
        `;
        messagesContainer.appendChild(typingDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    removeTypingIndicator() {
        const typingIndicator = document.getElementById('typingIndicator');
        if (typingIndicator) typingIndicator.remove();
    }
    
    clearChat() {
        const confirmMsg = this.currentLanguage === 'ta' 
            ? 'எல்லா செய்திகளையும் அழிக்கவா?'
            : 'Clear all messages';
        
        if (confirm(confirmMsg)) {
            const messagesContainer = document.getElementById('chatbotBody');
            if (messagesContainer) {
                const welcomeMsg = this.currentLanguage === 'ta'
                    ? 'அரட்டை அழிக்கப்பட்டது. நான் எவ்வாறு உதவலாம்?'
                    : 'Chat cleared. How can I help you';
                    
                messagesContainer.innerHTML = '';
                this.addMessage(welcomeMsg, 'bot');
                
                fetch('/api/clear', { method: 'POST' }).catch(console.error);
            }
        }
    }
    
    startVoiceInput() {
        if (!this.recognition) {
            if (!this.initSpeechRecognition()) {
                const errorMsg = this.currentLanguage === 'ta'
                    ? 'உங்கள் உலாவியில் குரல் உள்ளீடு ஆதரிக்கப்படவில்லை'
                    : 'Voice input not supported in your browser';
                alert(errorMsg);
                return;
            }
        }
        
        const micBtn = document.getElementById('micBtn');
        if (micBtn) {
            micBtn.style.backgroundColor = '#ff6f61';
            micBtn.style.transform = 'scale(1.1)';
            micBtn.textContent = 'Mic';
            micBtn.disabled = true;
        }
        
        this.recognition.lang = this.currentLanguage === 'ta' ? 'ta-IN' : 'en-IN';
        this.recognition.interimResults = true;
        this.recognition.continuous = false;
        
        const timeout = setTimeout(() => {
            if (this.recognition) {
                this.recognition.stop();
            }
        }, 10000);
        
        this.recognition.onresult = (event) => {
            clearTimeout(timeout);
            let transcript = '';
            
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    transcript = event.results[i][0].transcript;
                    break;
                }
                transcript += event.results[i][0].transcript;
            }
            
            const input = document.getElementById('chatbotInput');
            if (input && transcript) {
                input.value = transcript;
                this.pendingVoiceText = transcript;
                
                input.style.backgroundColor = '#e8f0fe';
                setTimeout(() => {
                    input.style.backgroundColor = '';
                }, 500);
            }
        };
        
        this.recognition.onerror = (event) => {
            clearTimeout(timeout);
            console.error('Speech error:', event.error);
            if (event.error !== 'no-speech') {
                const errorMsg = this.currentLanguage === 'ta'
                    ? 'குரலை அடையாளம் காண முடியவில்லை. மீண்டும் முயற்சி செய்யவும்'
                    : 'Could not recognize speech. Please try again';
                alert(errorMsg);
            }
            this.pendingVoiceText = null;
        };
        
        this.recognition.onend = () => {
            if (micBtn) {
                micBtn.style.backgroundColor = '';
                micBtn.style.transform = '';
                micBtn.textContent = 'Mic';
                micBtn.disabled = false;
            }
            
            if (this.pendingVoiceText) {
                const autoSend = this.pendingVoiceText;
                this.pendingVoiceText = null;
                const input = document.getElementById('chatbotInput');
                if (input) {
                    input.value = autoSend;
                    this.sendMessage();
                }
            } else {
                const input = document.getElementById('chatbotInput');
                if (input) input.focus();
            }
        };
        
        this.recognition.start();
    }
    
    setLanguage(lang) {
        this.currentLanguage = lang;
        
        const enBtn = document.getElementById('langEnBtn');
        const taBtn = document.getElementById('langTaBtn');
        
        if (enBtn && taBtn) {
            if (lang === 'en') {
                enBtn.classList.add('active');
                taBtn.classList.remove('active');
            } else {
                enBtn.classList.remove('active');
                taBtn.classList.add('active');
            }
        }
        
        const input = document.getElementById('chatbotInput');
        if (input) {
            input.placeholder = lang === 'en' 
                ? 'Type your message...' 
                : 'உங்கள் செய்தியை தட்டச்சு செய்யவும்';
        }
        
        const headerTitle = document.querySelector('.chatbot-header h3');
        if (headerTitle) {
            headerTitle.textContent = lang === 'en' ? 'Bank Assistant' : 'வங்கி உதவியாளர்';
        }
    }
    
    toggleVoiceGender() {
        this.voiceType = this.voiceType === 'male' ? 'female' : 'male';
        this.showToast(`${this.voiceType === 'male' ? 'Male' : 'Female'} voice activated`);
        console.log(`Voice gender: ${this.voiceType}`);
    }
    
    setSpeechRate(rate) {
        this.speechRate = Math.max(0.5, Math.min(1.5, rate));
        this.showToast(`Speech speed: ${this.speechRate}x`);
        console.log(`Speech rate: ${this.speechRate}`);
    }
    
    showToast(message) {
        let toast = document.getElementById('toastNotification');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toastNotification';
            toast.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0,0,0,0.8);
                color: white;
                padding: 8px 16px;
                border-radius: 4px;
                font-size: 14px;
                z-index: 10000;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.3s;
            `;
            document.body.appendChild(toast);
        }
        
        toast.textContent = message;
        toast.style.opacity = '1';
        
        setTimeout(() => {
            toast.style.opacity = '0';
        }, 2000);
    }
    
    toggleChat() {
        const chatWindow = document.getElementById('chatbot');
        const chatIcon = document.getElementById('chatbotIcon');
        
        if (chatWindow) {
            if (chatWindow.style.display === 'none' || chatWindow.style.display === '') {
                chatWindow.style.display = 'flex';
                if (chatIcon) chatIcon.style.display = 'none';
                chatWindow.classList.remove('minimized', 'maximized');
                this.isMinimized = false;
                this.isMaximized = false;
                setTimeout(() => {
                    const input = document.getElementById('chatbotInput');
                    if (input) input.focus();
                }, 100);
            } else {
                chatWindow.style.display = 'none';
                if (chatIcon) chatIcon.style.display = 'flex';
            }
        }
    }
    
    minimizeChat() {
        const chatWindow = document.getElementById('chatbot');
        if (chatWindow) {
            if (this.isMaximized) {
                chatWindow.classList.remove('maximized');
                this.isMaximized = false;
            }
            chatWindow.classList.add('minimized');
            this.isMinimized = true;
        }
    }
    
    maximizeChat() {
        const chatWindow = document.getElementById('chatbot');
        if (chatWindow) {
            if (this.isMinimized) {
                chatWindow.classList.remove('minimized');
                this.isMinimized = false;
            }
            
            if (this.isMaximized) {
                chatWindow.classList.remove('maximized');
                this.isMaximized = false;
            } else {
                chatWindow.classList.add('maximized');
                this.isMaximized = true;
            }
        }
    }
    
    restoreChat() {
        const chatWindow = document.getElementById('chatbot');
        if (chatWindow && this.isMinimized) {
            chatWindow.classList.remove('minimized');
            this.isMinimized = false;
            setTimeout(() => {
                document.getElementById('chatbotInput')?.focus();
            }, 100);
        }
    }
    
    async loadChatHistory() {
        const welcomeMsg = this.currentLanguage === 'ta'
            ? 'வணக்கம். நான் உங்கள் வங்கி உதவியாளர். நான் எவ்வாறு உதவலாம்?'
            : 'Hello. I am your bank assistant. How can I help you?';
        
        try {
            const response = await fetch('/api/history');
            const messagesContainer = document.getElementById('chatbotBody');
            
            if (messagesContainer) {
                messagesContainer.innerHTML = '';
                
                if (response.ok) {
                    const history = await response.json();
                    
                    if (history && history.length > 0) {
                        history.forEach(chat => {
                            this.addMessage(chat.user_message, 'user');
                            this.addMessage(chat.bot_response, 'bot');
                        });
                        return;
                    }
                }
                
                this.addMessage(welcomeMsg, 'bot');
            }
        } catch (error) {
            console.error('Error loading history:', error);
            const messagesContainer = document.getElementById('chatbotBody');
            if (messagesContainer && messagesContainer.innerHTML === '') {
                this.addMessage(welcomeMsg, 'bot');
            }
        }
    }
    
    attachEventListeners() {
        const sendBtn = document.getElementById('sendBtn');
        if (sendBtn) sendBtn.addEventListener('click', () => this.sendMessage());
        
        const micBtn = document.getElementById('micBtn');
        if (micBtn) micBtn.addEventListener('click', () => this.startVoiceInput());
        
        const clearBtn = document.getElementById('clearMessages');
        if (clearBtn) clearBtn.addEventListener('click', () => this.clearChat());
        
        const langEnBtn = document.getElementById('langEnBtn');
        const langTaBtn = document.getElementById('langTaBtn');
        if (langEnBtn) langEnBtn.addEventListener('click', () => this.setLanguage('en'));
        if (langTaBtn) langTaBtn.addEventListener('click', () => this.setLanguage('ta'));
        
        const minimizeBtn = document.getElementById('minimizeChatbot');
        const maximizeBtn = document.getElementById('maximizeChatbot');
        const closeBtn = document.getElementById('closeChatbot');
        
        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.minimizeChat();
            });
        }
        
        if (maximizeBtn) {
            maximizeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.maximizeChat();
            });
        }
        
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleChat();
            });
        }
        
        const input = document.getElementById('chatbotInput');
        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
        }
        
        const voiceGenderBtn = document.getElementById('voiceGenderBtn');
        if (voiceGenderBtn) {
            voiceGenderBtn.addEventListener('click', () => this.toggleVoiceGender());
        }
        
        const speechRateSlider = document.getElementById('speechRateSlider');
        if (speechRateSlider) {
            speechRateSlider.addEventListener('input', (e) => {
                this.setSpeechRate(parseFloat(e.target.value));
            });
        }
        
        window.addEventListener('resize', () => {
            const chatWindow = document.getElementById('chatbot');
            if (chatWindow && this.isMaximized && window.innerWidth < 768) {
                chatWindow.classList.remove('maximized');
                this.isMaximized = false;
            }
        });
    }
    
    setupChatIcon() {
        const chatIcon = document.getElementById('chatbotIcon');
        if (chatIcon) {
            chatIcon.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleChat();
            });
            
            chatIcon.addEventListener('mouseenter', () => {
                chatIcon.style.transform = 'scale(1.1)';
            });
            
            chatIcon.addEventListener('mouseleave', () => {
                chatIcon.style.transform = 'scale(1)';
            });
        }
    }
    
    stopSpeaking() {
        if (this.ttsAbortController) {
            this.ttsAbortController.abort();
            this.ttsAbortController = null;
        }
        
        this.speechQueue = [];
        this.isSpeaking = false;
        this.isProcessingQueue = false;
        
        if (this.audio) {
            this.audio.pause();
            this.audio = null;
        }
        
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        
        if (this.speakTimeout) {
            clearTimeout(this.speakTimeout);
        }
        
        this.hideSpeakingIndicator();
        console.log('All speech stopped and queue cleared');
    }
    
    isSupported() {
        const ttsSupported = 'speechSynthesis' in window;
        const sttSupported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
        return { ttsSupported, sttSupported };
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing BankBot');
    window.bankBot = new BankBot();
    
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'S') {
            e.preventDefault();
            if (window.bankBot) {
                window.bankBot.stopSpeaking();
                console.log('Speech stopped by user');
            }
        }
    });
    
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'V') {
            e.preventDefault();
            if (window.bankBot) {
                window.bankBot.toggleVoiceGender();
            }
        }
    });
});

window.addEventListener('beforeunload', () => {
    if (window.bankBot) {
        window.bankBot.stopSpeaking();
    }
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
});

if (typeof module !== 'undefined' && module.exports) {
    module.exports = BankBot;
}