// ChatFlow Frontend JavaScript
class ChatApp {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.isConnected = false;
        this.typingUsers = new Set();
        this.typingTimeout = null;
        
        this.initializeElements();
        this.attachEventListeners();
    }

    initializeElements() {
        // Modal elements
        this.userModal = document.getElementById('userModal');
        this.usernameInput = document.getElementById('usernameInput');
        this.joinBtn = document.getElementById('joinBtn');
        
        // Main chat elements
        this.chatContainer = document.getElementById('chatContainer');
        this.messagesContainer = document.getElementById('messagesContainer');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.usersList = document.getElementById('usersList');
        this.userCount = document.getElementById('userCount');
        this.currentUsername = document.getElementById('currentUsername');
        this.connectionIcon = document.getElementById('connectionIcon');
        this.connectionText = document.getElementById('connectionText');
        this.typingIndicator = document.getElementById('typingIndicator');
        this.typingText = document.getElementById('typingText');
    }

    attachEventListeners() {
        // Join chat listeners
        this.joinBtn.addEventListener('click', () => this.handleJoinChat());
        this.usernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleJoinChat();
        });
        this.usernameInput.addEventListener('input', (e) => {
            this.joinBtn.disabled = e.target.value.trim().length < 2;
        });

        // Message input listeners
        this.sendBtn.addEventListener('click', () => this.handleSendMessage());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSendMessage();
            } else {
                this.handleTyping();
            }
        });

        this.messageInput.addEventListener('input', (e) => {
            this.sendBtn.disabled = !e.target.value.trim();
            this.autoResizeTextarea(e.target);
        });

        // Auto-focus username input
        this.usernameInput.focus();
    }

    autoResizeTextarea(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }

    handleJoinChat() {
        const username = this.usernameInput.value.trim();
        
        if (username.length < 2) {
            this.showNotification('Please enter a valid username (minimum 2 characters)', 'error');
            return;
        }

        this.currentUser = {
            userId: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            username: username,
            avatar: '👤'
        };

        this.initializeSocket();
        this.hideModal();
        this.showChatInterface();
    }

    initializeSocket() {
        // For demo purposes, we'll use the simulated socket from your original code
        // In production, use: this.socket = io('http://localhost:5000');
        this.socket = new SocketClient();
        
        this.setupSocketListeners();
        this.joinRoom();
    }

    setupSocketListeners() {
        this.socket.on('connected', () => {
            this.updateConnectionStatus(true);
        });

        this.socket.on('disconnected', () => {
            this.updateConnectionStatus(false);
        });

        this.socket.on('receive-message', (message) => {
            this.displayMessage(message);
        });

        this.socket.on('users-update', (users) => {
            this.updateUsersList(users);
        });

        this.socket.on('user-typing', ({ userId, username, typing }) => {
            this.handleTypingIndicator(userId, username, typing);
        });

        this.socket.on('error', (error) => {
            this.showNotification(error.message, 'error');
        });
    }

    joinRoom() {
        this.socket.emit('join-room', this.currentUser);
    }

    hideModal() {
        this.userModal.classList.add('hidden');
    }

    showChatInterface() {
        this.chatContainer.classList.remove('hidden');
        this.currentUsername.textContent = this.currentUser.username;
        this.messageInput.focus();
    }

    updateConnectionStatus(connected) {
        this.isConnected = connected;
        this.connectionIcon.className = connected ? 'fas fa-wifi' : 'fas fa-wifi-slash';
        this.connectionText.textContent = connected ? 'Connected' : 'Connecting...';
    }

    handleSendMessage() {
        const content = this.messageInput.value.trim();
        
        if (!content || !this.isConnected) return;

        const messageData = {
            content: content,
            username: this.currentUser.username,
            userId: this.currentUser.userId,
            type: 'user',
            avatar: this.currentUser.avatar
        };

        this.socket.emit('send-message', messageData);
        this.messageInput.value = '';
        this.messageInput.style.height = 'auto';
        this.sendBtn.disabled = true;
        
        // Stop typing indicator
        this.socket.emit('typing-stop', {
            userId: this.currentUser.userId,
            username: this.currentUser.username
        });
    }

    handleTyping() {
        if (!this.currentUser) return;

        this.socket.emit('typing-start', {
            userId: this.currentUser.userId,
            username: this.currentUser.username
        });

        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
            this.socket.emit('typing-stop', {
                userId: this.currentUser.userId,
                username: this.currentUser.username
            });
        }, 2000);
    }

    displayMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'message';
        
        if (message.type === 'system') {
            messageElement.innerHTML = `
                <div class="system-message">
                    ${message.content}
                </div>
            `;
        } else {
            const isOwnMessage = message.userId === this.currentUser?.userId;
            messageElement.classList.toggle('own', isOwnMessage);
            
            messageElement.innerHTML = `
                <div class="message-avatar">
                    ${message.avatar || '👤'}
                </div>
                <div class="message-content">
                    <div class="message-header">
                        <span class="message-username">${message.username}</span>
                        <span class="message-time">${this.formatTimestamp(message.timestamp)}</span>
                    </div>
                    <div class="message-bubble">
                        ${this.escapeHtml(message.content)}
                    </div>
                </div>
            `;
        }
        
        this.messagesContainer.appendChild(messageElement);
        this.scrollToBottom();
    }

    updateUsersList(users) {
        this.userCount.textContent = users.length;
        this.usersList.innerHTML = '';
        
        users.forEach(user => {
            const userElement = document.createElement('div');
            userElement.className = 'user-item';
            userElement.innerHTML = `
                <div class="user-avatar">
                    ${user.avatar || '👤'}
                </div>
                <div class="user-info">
                    <div class="user-name">${this.escapeHtml(user.username)}</div>
                    <div class="user-status">
                        <div class="status-dot"></div>
                        Online
                    </div>
                </div>
            `;
            this.usersList.appendChild(userElement);
        });
    }

    handleTypingIndicator(userId, username, typing) {
        if (userId === this.currentUser?.userId) return;
        
        if (typing) {
            this.typingUsers.add(username);
        } else {
            this.typingUsers.delete(username);
        }
        
        this.updateTypingDisplay();
    }

    updateTypingDisplay() {
        if (this.typingUsers.size === 0) {
            this.typingIndicator.classList.add('hidden');
            return;
        }
        
        const typingArray = Array.from(this.typingUsers);
        let text = '';
        
        if (typingArray.length === 1) {
            text = `${typingArray[0]} is typing...`;
        } else if (typingArray.length === 2) {
            text = `${typingArray[0]} and ${typingArray[1]} are typing...`;
        } else {
            text = `${typingArray[0]}, ${typingArray[1]} and ${typingArray.length - 2} others are typing...`;
        }
        
        this.typingText.textContent = text;
        this.typingIndicator.classList.remove('hidden');
    }

    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    formatTimestamp(timestamp) {
        return new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showNotification(message, type) {
        // Simple notification system
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'error' ? '#e53e3e' : '#38a169'};
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1001;
            animation: slideIn 0.3s ease-out;
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
}

// Simulated Socket.IO client for demo (same as your original code)
class SocketClient {
    constructor() {
        this.callbacks = {};
        this.connected = false;
        this.users = new Map();
        this.messages = [];
        this.currentUser = null;
        
        // Simulate connection after a delay
        setTimeout(() => {
            this.connected = true;
            this.emit('connected');
        }, 1000);
    }

    on(event, callback) {
        if (!this.callbacks[event]) {
            this.callbacks[event] = [];
        }
        this.callbacks[event].push(callback);
    }

    emit(event, data) {
        if (event === 'join-room') {
            this.currentUser = data;
            this.users.set(data.userId, data);
            
            // Simulate other users
            const demoUsers = [
                { userId: 'demo1', username: 'Sarah Wilson', avatar: '👩‍💼' },
                { userId: 'demo2', username: 'Mike Chen', avatar: '👨‍💻' },
                { userId: 'demo3', username: 'Elena Rodriguez', avatar: '👩‍🎨' }
            ];
            
            demoUsers.forEach(user => this.users.set(user.userId, user));
            
            this.trigger('user-joined', data);
            this.trigger('users-update', Array.from(this.users.values()));
            
            // Add welcome message
            setTimeout(() => {
                this.trigger('receive-message', {
                    messageId: Date.now(),
                    content: `Welcome ${data.username}! 🎉`,
                    username: 'System',
                    userId: 'system',
                    timestamp: new Date().toISOString(),
                    type: 'system'
                });
            }, 500);
            
        } else if (event === 'send-message') {
            const message = {
                ...data,
                messageId: Date.now() + Math.random(),
                timestamp: new Date().toISOString()
            };
            
            this.messages.push(message);
            this.trigger('receive-message', message);
            
            // Simulate responses from other users
            setTimeout(() => {
                this.simulateResponse();
            }, Math.random() * 3000 + 1000);
            
        } else if (event === 'typing-start') {
            this.trigger('user-typing', { userId: data.userId, username: data.username, typing: true });
            
        } else if (event === 'typing-stop') {
            this.trigger('user-typing', { userId: data.userId, username: data.username, typing: false });
        }
        
        // Trigger callbacks
        this.trigger(event, data);
    }

    trigger(event, data) {
        if (this.callbacks[event]) {
            this.callbacks[event].forEach(callback => callback(data));
        }
    }

    simulateResponse() {
        const responses = [
            "That's really interesting! 🤔",
            "I totally agree with that point",
            "Thanks for sharing your thoughts!",
            "Great discussion happening here 👍",
            "Has anyone tried that approach before?",
            "Really good insight there",
            "I've been thinking about that too",
            "Excellent point! 💡"
        ];

        const demoUsers = Array.from(this.users.values()).filter(u => u.userId.startsWith('demo'));
        if (demoUsers.length === 0) return;

        const randomUser = demoUsers[Math.floor(Math.random() * demoUsers.length)];
        const randomResponse = responses[Math.floor(Math.random() * responses.length)];

        // Show typing first
        this.trigger('user-typing', { userId: randomUser.userId, username: randomUser.username, typing: true });

        setTimeout(() => {
            this.trigger('user-typing', { userId: randomUser.userId, username: randomUser.username, typing: false });
            
            const message = {
                messageId: Date.now() + Math.random(),
                content: randomResponse,
                username: randomUser.username,
                userId: randomUser.userId,
                timestamp: new Date().toISOString(),
                type: 'user',
                avatar: randomUser.avatar
            };
            
            this.trigger('receive-message', message);
        }, 1500);
    }

    disconnect() {
        this.connected = false;
        this.trigger('disconnected');
    }
}

// Initialize the chat application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ChatApp();
});