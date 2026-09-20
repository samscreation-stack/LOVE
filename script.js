(() => {
    'use strict';

    /* =====================================================================
       CONFIG — change these to personalise the page
       ===================================================================== */
    const CONFIG = {
        recipient: 'Maleka',          // shown on screen: "for Maleka 💗"
        sender: 'Sam',                // shown in the letter signature
        nickname: 'Sunflower',        // used in the default letter: "Dear Sunflower,"
        message: null,                // set your own letter text here, or leave null for the default
        allowEditing: true,           // false = hide the pencil/edit button (nice for the recipient's copy)
        words: [                      // the words that rain down and form the heart
            'I love you Sunflower', 'I love you Maleka', '❤', 'love', 'kiss you',
            'Helianthus', 'forever', 'always', 'you', 'me & you', 'love you',
            'Janeman', 'Malekabanu', 'my sunflower'
        ]
    };

    const NUM_POINTS = 180;
    const BASE_SPIN = 0.72;           // radians per second (was 0.012 per frame)
    const RAIN_DURATION = 2800;
    const ASSEMBLE_DURATION = 2200;
    const BEAT_CYCLE = 1500;
    const MAX_NAME = 30;
    const MAX_MESSAGE = 800;
    const FONT = "'Plus Jakarta Sans', 'Segoe UI', system-ui, sans-serif";

    const $ = (id) => document.getElementById(id);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    // localStorage can throw (private mode, blocked cookies, file://) — never let that break the page
    const store = {
        get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
        set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* ignore */ } }
    };

    const els = {
        canvas: $('c'),
        msg: $('msg'),
        tapHint: $('tapHint'),
        soundBtn: $('soundBtn'),
        startOverlay: $('startOverlay'),
        startBtn: $('startBtn'),
        loadingBar: $('loadingBar'),
        statusText: $('statusText'),
        letterOverlay: $('letterOverlay'),
        letterCard: $('letterCard'),
        letterClose: $('letterClose'),
        letterEditBtn: $('letterEditBtn'),
        letterHeaderTitle: $('letterHeaderTitle'),
        letterBody: $('letterBody'),
        letterSign: $('letterSign'),
        recipientInput: $('recipientInput'),
        senderInput: $('senderInput'),
        messageInput: $('messageInput'),
        saveBtn: $('saveLetterBtn'),
        shareBtn: $('shareLetterBtn'),
        shareToast: $('shareToast')
    };

    // Warm the webfont so the canvas text doesn't flash a fallback face
    if (document.fonts && document.fonts.load) {
        document.fonts.load(`600 14px "Plus Jakarta Sans"`).catch(() => { });
    }

    /* =====================================================================
       Canvas sizing
       ===================================================================== */
    const canvas = els.canvas;
    const ctx = canvas.getContext('2d');

    let W = 0, H = 0, CX = 0, CY = 0, dpr = 1, scale = 1, fontScale = 1;

    function resize() {
        W = window.innerWidth;
        H = window.innerHeight;
        CX = W / 2;
        CY = H / 2;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        scale = Math.min(W, H) * (H > W ? 0.25 : 0.22); // a bit bigger on portrait phones so the words crowd less
        fontScale = clamp(Math.min(W, H) / 620, 1, 1.7);
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();

    /* =====================================================================
       Sound (one shared AudioContext, created on the first click)
       ===================================================================== */
    let audioCtx = null;
    let soundOn = store.get('love_sound') !== 'off';

    function getAudio() {
        if (!soundOn) return null;
        try {
            if (!audioCtx) {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return null;
                audioCtx = new AC();
            }
            if (audioCtx.state === 'suspended') audioCtx.resume();
            return audioCtx;
        } catch (e) {
            return null;
        }
    }

    function playTone({ from, to, dur, vol, type = 'sine' }) {
        const a = getAudio();
        if (!a) return;
        try {
            const t = a.currentTime;
            const osc = a.createOscillator();
            const gain = a.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(from, t);
            osc.frequency.exponentialRampToValueAtTime(to, t + dur);
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            osc.connect(gain);
            gain.connect(a.destination);
            osc.start(t);
            osc.stop(t + dur + 0.03);
        } catch (e) { /* ignore */ }
    }

    const playClickSound = () => playTone({ from: 600, to: 1000, dur: 0.08, vol: 0.05 });
    // Soft "lub-dub". Triangle wave keeps some upper harmonics so phone speakers can reproduce it.
    const playLub = () => playTone({ from: 120, to: 55, dur: 0.22, vol: 0.28, type: 'triangle' });
    const playDub = () => playTone({ from: 100, to: 50, dur: 0.18, vol: 0.2, type: 'triangle' });

    function renderSoundBtn() {
        els.soundBtn.textContent = soundOn ? '🔊' : '🔇';
        els.soundBtn.setAttribute('aria-pressed', String(!soundOn));
        els.soundBtn.setAttribute('aria-label', soundOn ? 'Mute heartbeat sound' : 'Unmute heartbeat sound');
    }
    renderSoundBtn();

    els.soundBtn.addEventListener('click', () => {
        soundOn = !soundOn;
        store.set('love_sound', soundOn ? 'on' : 'off');
        renderSoundBtn();
        playClickSound();
    });

    /* =====================================================================
       Love data: defaults → localStorage → share link (?d=) → ?to=&from=&msg=
       ===================================================================== */
    let recipient = CONFIG.recipient;
    let sender = CONFIG.sender;
    let message = '';

    function defaultMessage(name) {
        const greeting = name === CONFIG.recipient ? CONFIG.nickname : name;
        return `Dear ${greeting},\n\nThis is my love for you... 🌹\n\nEvery line of code, every pixel, and every beat of this heart is a reminder of how incredibly special you are to me. You make my world so much brighter, and my life complete. ✨\n\nNo matter where life takes us, my heart will always run in an infinite loop for you, beating forever and always. You are my today and all of my tomorrows. 💗💍`;
    }

    function clean(value, max) {
        if (typeof value !== 'string') return '';
        return Array.from(value.replace(/\r\n?/g, '\n').trim()).slice(0, max).join('');
    }

    // URL-safe base64 of UTF-8 JSON. (Plain base64 contains "+", which URLSearchParams turns into a
    // space — that silently broke some share links before.)
    function encodeData(obj) {
        const bytes = new TextEncoder().encode(JSON.stringify(obj));
        let bin = '';
        bytes.forEach((b) => { bin += String.fromCharCode(b); });
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function decodeData(str) {
        let b64 = str.trim().replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        const bin = atob(b64);
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        return JSON.parse(new TextDecoder().decode(bytes));
    }

    function pick(src) {
        const out = {};
        if (src && typeof src === 'object') {
            ['to', 'from', 'msg'].forEach((k) => {
                if (typeof src[k] === 'string' && src[k].trim()) out[k] = src[k];
            });
        }
        return out;
    }

    function loadLoveData() {
        const params = new URLSearchParams(window.location.search);
        let fromUrl = {};

        const d = params.get('d');
        if (d) {
            try { fromUrl = pick(decodeData(d)); }
            catch (e) { console.warn("Couldn't read the share link data", e); }
        }
        Object.assign(fromUrl, pick({ to: params.get('to'), from: params.get('from'), msg: params.get('msg') }));

        // A link always wins; only fall back to this browser's saved copy when there is no link data
        const data = Object.keys(fromUrl).length
            ? fromUrl
            : pick({ to: store.get('love_to'), from: store.get('love_from'), msg: store.get('love_msg') });

        recipient = clean(data.to, MAX_NAME) || CONFIG.recipient;
        sender = clean(data.from, MAX_NAME) || CONFIG.sender;
        message = clean(data.msg, MAX_MESSAGE) || CONFIG.message || defaultMessage(recipient);
    }

    function applyLoveData() {
        els.recipientInput.value = recipient;
        els.senderInput.value = sender;
        els.messageInput.value = message;
        els.letterHeaderTitle.textContent = `for ${recipient}`;
        els.letterSign.textContent = `— coded with love by ${sender}`;
        const span = document.querySelector('.m2 span');
        if (span) span.textContent = recipient;
        document.title = `💗 I made this heartbeat for you, ${recipient}`;
    }

    loadLoveData();
    applyLoveData();
    if (!CONFIG.allowEditing) els.letterEditBtn.hidden = true;

    /* =====================================================================
       Intro card + loader
       ===================================================================== */
    let startTimestamp = null;
    let isIntroFinished = false;

    function startCardLoader() {
        const duration = 2400;
        const steps = [
            { threshold: 20, text: 'Initiating self-destruction... 💣' },
            { threshold: 50, text: `Bypassing ${sender}'s security... 🔓` },
            { threshold: 80, text: `Stealing ${sender}'s heart... 🕵️‍♂️` },
            { threshold: 95, text: 'Injecting 999 tons of love... 💖' },
            { threshold: 100, text: 'Explosion imminent! 💥' }
        ];
        let loaderStart = null;

        function animateLoader(timestamp) {
            if (loaderStart === null) loaderStart = timestamp;
            const progress = Math.min((timestamp - loaderStart) / duration, 1);
            const percent = Math.floor(progress * 100);

            els.loadingBar.style.width = `${percent}%`;
            const step = steps.find((s) => percent <= s.threshold) || steps[steps.length - 1];
            els.statusText.textContent = step.text;

            if (progress < 1) {
                requestAnimationFrame(animateLoader);
            } else {
                els.startBtn.removeAttribute('disabled');
                els.startBtn.focus({ preventScroll: true });
            }
        }
        requestAnimationFrame(animateLoader);
    }
    setTimeout(startCardLoader, 400);

    els.startBtn.addEventListener('click', () => {
        playClickSound();
        els.startOverlay.classList.add('fade-out');
        els.soundBtn.classList.add('visible');
        setTimeout(() => {
            startTimestamp = performance.now();
            isIntroFinished = true;
        }, 800);
    }, { once: true });

    /* =====================================================================
       Letter overlay
       ===================================================================== */
    let isLetterOpen = false;
    let lastOpenTime = 0;
    let hintDismissed = false;
    let typing = null; // { timer, finish } while the typewriter is running

    const segmenter = (typeof Intl !== 'undefined' && Intl.Segmenter)
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null;

    // Split into user-perceived characters so emoji (🌹, 💗, 🕵️‍♂️ ...) are never cut in half
    function splitGraphemes(str) {
        return segmenter ? Array.from(segmenter.segment(str), (s) => s.segment) : Array.from(str);
    }

    function stopTyping(finish) {
        if (!typing) return;
        clearTimeout(typing.timer);
        const t = typing;
        typing = null;
        if (finish) t.finish();
    }

    // Text is inserted with text nodes (never innerHTML), so a crafted link can't inject HTML.
    // The not-yet-typed part stays in the layout as hidden text, so the card doesn't jump around.
    function renderLetter(animate, delay = 0) {
        stopTyping();
        const body = els.letterBody;
        body.textContent = '';

        const typedNode = document.createTextNode('');
        const restNode = document.createTextNode(message);
        const rest = document.createElement('span');
        rest.className = 'letter-pending';
        rest.appendChild(restNode);
        body.append(typedNode, rest);

        const finish = () => { typedNode.data = message; restNode.data = ''; };
        if (!animate || reducedMotion) { finish(); return; }

        const chars = splitGraphemes(message);
        const state = { timer: null, finish };
        typing = state;
        let i = 0;

        const step = () => {
            if (typing !== state) return;
            if (i >= chars.length) { typing = null; return; }
            const ch = chars[i++];
            typedNode.appendData(ch);
            restNode.deleteData(0, ch.length);
            let wait = 32;
            if (/[.!?…]$/.test(ch)) wait = 280;
            else if (/[,;:]$/.test(ch)) wait = 150;
            else if (ch.indexOf('\n') !== -1) wait = 220;
            state.timer = setTimeout(step, wait);
        };
        state.timer = setTimeout(step, delay);
    }

    function setEditing(on) {
        els.letterCard.classList.toggle('editing', on);
        els.letterEditBtn.setAttribute('aria-pressed', String(on));
        els.letterEditBtn.title = on ? 'Back to letter' : 'Edit letter';
        els.letterEditBtn.setAttribute('aria-label', on ? 'Back to letter' : 'Edit letter');
        if (on) {
            stopTyping(true);
            els.recipientInput.value = recipient;
            els.senderInput.value = sender;
            els.messageInput.value = message;
        }
        els.letterCard.scrollTop = 0;
    }

    function readyToOpen() {
        return isIntroFinished && performance.now() - startTimestamp > RAIN_DURATION + ASSEMBLE_DURATION;
    }

    function dismissHint() {
        hintDismissed = true;
        els.tapHint.classList.remove('show');
    }

    function openLetter() {
        if (isLetterOpen) return;
        isLetterOpen = true;
        lastOpenTime = performance.now();
        playClickSound();
        dismissHint();
        setEditing(false);
        els.letterOverlay.classList.add('active');
        renderLetter(true, 450);
        els.letterClose.focus({ preventScroll: true });
    }

    function closeLetter() {
        if (!isLetterOpen) return;
        isLetterOpen = false;
        playClickSound();
        stopTyping();
        els.letterOverlay.classList.remove('active');
        setEditing(false);
    }

    els.letterEditBtn.addEventListener('click', () => {
        playClickSound();
        const editing = els.letterCard.classList.contains('editing');
        setEditing(!editing);
        if (editing) renderLetter(false); // leaving the editor without saving: show the current letter
    });

    els.saveBtn.addEventListener('click', () => {
        playClickSound();
        recipient = clean(els.recipientInput.value, MAX_NAME) || CONFIG.recipient;
        sender = clean(els.senderInput.value, MAX_NAME) || CONFIG.sender;
        message = clean(els.messageInput.value, MAX_MESSAGE) || CONFIG.message || defaultMessage(recipient);

        store.set('love_to', recipient);
        store.set('love_from', sender);
        store.set('love_msg', message);

        applyLoveData();
        setEditing(false);
        renderLetter(true, 250); // preview the saved letter
    });

    let toastTimer = null;
    function showToast(text) {
        els.shareToast.textContent = text;
        els.shareToast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => els.shareToast.classList.remove('show'), 3000);
    }

    async function copyText(text) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (e) { /* fall through to the legacy path */ }
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
            document.body.appendChild(ta);
            ta.select();
            ta.setSelectionRange(0, text.length);
            const ok = document.execCommand('copy');
            ta.remove();
            return ok;
        } catch (e) {
            return false;
        }
    }

    els.shareBtn.addEventListener('click', async () => {
        playClickSound();
        const data = {
            to: clean(els.recipientInput.value, MAX_NAME) || recipient,
            from: clean(els.senderInput.value, MAX_NAME) || sender,
            msg: clean(els.messageInput.value, MAX_MESSAGE) || message
        };
        let url;
        try {
            url = `${window.location.href.split(/[?#]/)[0]}?d=${encodeData(data)}`;
        } catch (e) {
            showToast("Couldn't build the link");
            return;
        }
        if (await copyText(url)) {
            showToast('Link copied to clipboard!');
        } else {
            window.prompt('Copy this link:', url);
        }
    });

    els.letterClose.addEventListener('click', (e) => {
        e.stopPropagation();
        closeLetter();
    });

    els.letterOverlay.addEventListener('click', (e) => {
        // The tap that opened the letter can echo as a "ghost click" on the backdrop — ignore it
        if (performance.now() - lastOpenTime < 500) return;
        if (e.target === els.letterOverlay) closeLetter();
    });

    // Tap the letter to skip the typing animation
    els.letterBody.addEventListener('click', () => stopTyping(true));

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isLetterOpen) {
            closeLetter();
        } else if ((e.key === 'Enter' || e.key === ' ') && !isLetterOpen && readyToOpen()
            && (document.activeElement === document.body || document.activeElement === null)) {
            e.preventDefault();
            openLetter();
        }
    });

    /* =====================================================================
       3D heart maths
       ===================================================================== */
    function getHeartPoint(t, layer) {
        const x = Math.pow(Math.sin(t), 3);
        const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16;

        const r = Math.sqrt(1 - layer * layer);
        const depthScale = 0.45 + 0.55 * r;

        return {
            x: x * depthScale * 1.5,
            y: (y * depthScale - 0.08) * 1.5,
            z: layer * 0.7
        };
    }

    function project3D(point, rotY, rotX) {
        const cosY = Math.cos(rotY);
        const sinY = Math.sin(rotY);
        const x1 = point.x * cosY - point.z * sinY;
        const z1 = point.x * sinY + point.z * cosY;

        const cosX = Math.cos(rotX);
        const sinX = Math.sin(rotX);
        const y2 = point.y * cosX - z1 * sinX;
        const z2 = point.y * sinX + z1 * cosX;

        const dist = 3.5;
        const perspective = dist / (dist + z2);

        point.projX = CX + x1 * scale * perspective;
        point.projY = CY + y2 * scale * perspective;
        point.projZ = z2;
        point.projScale = perspective;
    }

    class Particle3D {
        constructor(index) {
            this.index = index;
            this.text = CONFIG.words[index % CONFIG.words.length];

            this.rainZ = (Math.random() - 0.5) * 0.4;
            this.speedY = (Math.random() * 0.03 + 0.03) * 60;   // units per second
            this.speedX = (Math.random() - 0.5) * 0.06;
            this.layoutRain();

            const theta = (index / NUM_POINTS) * Math.PI * 2 * 7;
            const layer = (index / NUM_POINTS) * 2 - 1;
            const hp = getHeartPoint(theta, layer);
            this.targetX = hp.x;
            this.targetY = hp.y;
            this.targetZ = hp.z;

            this.x = this.rainX;
            this.y = this.rainY;
            this.z = this.rainZ;

            this.trail = [];
            this.maxTrail = 5;

            this.assembleDelay = Math.random() * 0.4;
            this.fontSize = Math.random() < 0.25 ? 14 : (Math.random() < 0.7 ? 11.5 : 10);
            this.weight = '600';
            this.opacity = Math.random() * 0.3 + 0.7;
            this.noiseOffset = Math.random() * 100;
        }

        layoutRain() {
            const spanX = W / scale;
            const spanY = H / scale;
            this.rainX = (Math.random() - 0.5) * spanX * 1.1;
            this.rainY = -spanY * 0.65 - Math.random() * spanY * 0.5;
        }

        update(phase, progress, rotY, rotX, beatFactor, time, dt) {
            const spanY = H / scale;

            if (phase === 'rain') {
                this.rainY += this.speedY * dt;
                this.rainX += this.speedX * dt;

                if (this.rainY > spanY * 0.6) {
                    this.rainY = -spanY * 0.65;
                    this.rainX = (Math.random() - 0.5) * (W / scale) * 1.1;
                    this.trail = [];
                }
                this.x = this.rainX;
                this.y = this.rainY;
                this.z = this.rainZ;

            } else if (phase === 'assemble') {
                const adj = clamp((progress - this.assembleDelay) / (1 - this.assembleDelay), 0, 1);
                const t = easeInOutCubic(adj);
                this.x = lerp(this.rainX, this.targetX, t);
                this.y = lerp(this.rainY, this.targetY, t);
                this.z = lerp(this.rainZ, this.targetZ, t);

            } else {
                const wave = Math.sin(time * 2.5 + this.noiseOffset) * 0.02;
                this.x = (this.targetX + wave) * beatFactor;
                this.y = (this.targetY + wave) * beatFactor;
                this.z = (this.targetZ + wave) * beatFactor;
            }

            project3D(this, phase === 'rain' ? 0 : rotY, phase === 'rain' ? 0.05 : rotX);

            if (phase !== 'beating') {
                this.trail.push({ x: this.projX, y: this.projY });
                if (this.trail.length > this.maxTrail) this.trail.shift();
            } else if (this.trail.length) {
                this.trail = [];
            }
        }
    }

    class Sparkle {
        constructor() {
            this.x = CX + (Math.random() - 0.5) * 30;
            this.y = CY + (Math.random() - 0.5) * 30 - 10;
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 4 + 2;
            this.vx = Math.cos(angle) * speed;
            this.vy = Math.sin(angle) * speed - Math.random() * 1.2;
            this.size = Math.random() * 2.5 + 1;
            this.alpha = 1;
            this.decay = Math.random() * 0.025 + 0.02;
            this.isHeart = Math.random() < 0.4;

            const colors = [
                { r: 255, g: 45, b: 85 },
                { r: 196, g: 71, b: 245 },
                { r: 255, g: 107, b: 157 }
            ];
            this.color = colors[Math.floor(Math.random() * colors.length)];
        }

        update(f) {
            this.x += this.vx * f;
            this.y += this.vy * f;
            const friction = Math.pow(0.96, f);
            this.vx *= friction;
            this.vy *= friction;
            this.vy += 0.04 * f;
            this.alpha -= this.decay * f;
        }

        draw() {
            if (this.alpha <= 0) return;
            ctx.save();
            ctx.globalAlpha = this.alpha;
            ctx.fillStyle = `rgb(${this.color.r}, ${this.color.g}, ${this.color.b})`;

            if (this.isHeart) {
                const s = this.size * 2.5;
                ctx.translate(this.x, this.y);
                ctx.beginPath();
                ctx.moveTo(0, s * 0.3);
                ctx.bezierCurveTo(-s * 0.5, -s * 0.2, -s, s * 0.1, 0, s);
                ctx.bezierCurveTo(s, s * 0.1, s * 0.5, -s * 0.2, 0, s * 0.3);
                ctx.fill();
            } else {
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
    }

    class BackgroundStar {
        constructor() {
            this.randomise();
            this.speed = Math.random() * 1.5 + 0.5;       // twinkle rate in rad/s (was ~0.01, i.e. never twinkled)
            this.offset = Math.random() * Math.PI * 2;
        }

        randomise() {
            this.x = Math.random() * W;
            this.y = Math.random() * H;
            this.size = Math.random() * 1.2 + 0.3;
            this.baseAlpha = Math.random() * 0.25 + 0.05;
        }

        draw(time) {
            const alpha = this.baseAlpha + Math.sin(time * this.speed + this.offset) * 0.08;
            ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0.02, alpha).toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    const heartParticles = [];
    for (let i = 0; i < NUM_POINTS; i++) heartParticles.push(new Particle3D(i));

    const bgStars = [];
    for (let i = 0; i < 70; i++) bgStars.push(new BackgroundStar());

    let sparkles = [];

    window.addEventListener('resize', () => {
        resize();
        bgStars.forEach((s) => s.randomise());
        heartParticles.forEach((p) => p.layoutRain());
    });

    /* =====================================================================
       Interaction: drag to spin (with momentum), tap to open the letter
       ===================================================================== */
    let rotY = 0;
    let rotX = 0.2;
    let prevRotY = 0;
    let spinVel = BASE_SPIN;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let baseRotY = 0;
    let baseRotX = 0;

    canvas.addEventListener('pointerdown', (e) => {
        if (!e.isPrimary || !isIntroFinished) return;
        if (performance.now() - startTimestamp < RAIN_DURATION) return; // heart isn't formed yet
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        baseRotY = rotY;
        baseRotX = rotX;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!isDragging || !e.isPrimary) return;
        rotY = baseRotY + (e.clientX - startX) * 0.007;
        rotX = clamp(baseRotX + (e.clientY - startY) * 0.007, -0.6, 0.8);
    });

    canvas.addEventListener('pointerup', (e) => {
        if (!isDragging || !e.isPrimary) return;
        isDragging = false;
        const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
        if (dist < 6 && readyToOpen()) openLetter();
    });

    canvas.addEventListener('pointercancel', () => { isDragging = false; });

    /* =====================================================================
       Main loop
       ===================================================================== */
    let lastFrame = null;
    let beatIntensity = 0;
    let lastCycle = -1;
    let beatFired = [false, false, false, false];
    let msgShown = false;

    function triggerBeatExplosion() {
        if (reducedMotion || sparkles.length >= 25) return;
        const count = Math.floor(Math.random() * 5) + 8;
        for (let i = 0; i < count; i++) sparkles.push(new Sparkle());
    }

    // Each event fires exactly once per heartbeat, whatever the screen's refresh rate
    const BEAT_EVENTS = [
        { at: 0, run: playLub },
        { at: 70, run: triggerBeatExplosion },
        { at: 260, run: playDub },
        { at: 335, run: triggerBeatExplosion }
    ];

    function loop(now) {
        requestAnimationFrame(loop);
        if (!isIntroFinished) return;

        const dtMs = lastFrame === null ? 16.667 : clamp(now - lastFrame, 1, 50);
        lastFrame = now;
        const dt = dtMs / 1000;       // seconds
        const f = dtMs / 16.667;      // 1.0 at 60fps
        const elapsed = Math.max(0, now - startTimestamp);
        const time = now * 0.001;

        ctx.clearRect(0, 0, W, H);
        bgStars.forEach((star) => star.draw(time));

        let phase;
        let progress = 1;
        if (elapsed < RAIN_DURATION) {
            phase = 'rain';
            progress = elapsed / RAIN_DURATION;
        } else if (elapsed < RAIN_DURATION + ASSEMBLE_DURATION) {
            phase = 'assemble';
            progress = (elapsed - RAIN_DURATION) / ASSEMBLE_DURATION;
        } else {
            phase = 'beating';
        }

        let beatFactor = 1.0;
        if (phase === 'beating') {
            const sinceBeat = elapsed - (RAIN_DURATION + ASSEMBLE_DURATION);
            const cycleIdx = Math.floor(sinceBeat / BEAT_CYCLE);
            const cp = sinceBeat - cycleIdx * BEAT_CYCLE;

            if (cycleIdx !== lastCycle) {
                lastCycle = cycleIdx;
                beatFired = [false, false, false, false];
            }
            BEAT_EVENTS.forEach((ev, i) => {
                if (!beatFired[i] && cp >= ev.at) {
                    beatFired[i] = true;
                    ev.run();
                }
            });

            if (cp < 140) {
                const t = cp / 140;
                beatFactor = 1.0 + Math.sin(t * Math.PI) * 0.15;
                beatIntensity = Math.sin(t * Math.PI);
            } else if (cp >= 260 && cp < 410) {
                const t = (cp - 260) / 150;
                beatFactor = 1.0 + Math.sin(t * Math.PI) * 0.11;
                beatIntensity = Math.sin(t * Math.PI) * 0.7;
            } else {
                beatIntensity = Math.max(0, beatIntensity - 0.04 * f);
            }
        }

        const glowOpacity = phase === 'beating' ? 0.03 + beatIntensity * 0.08 : 0.02;
        const radialGlow = ctx.createRadialGradient(CX, CY, 10, CX, CY, Math.max(W, H) * 0.4);
        radialGlow.addColorStop(0, `rgba(255, 45, 85, ${glowOpacity})`);
        radialGlow.addColorStop(0.5, `rgba(196, 71, 245, ${glowOpacity * 0.3})`);
        radialGlow.addColorStop(1, 'rgba(196, 71, 245, 0)');
        ctx.fillStyle = radialGlow;
        ctx.fillRect(0, 0, W, H);

        // Spin: follows the finger while dragging, then glides back to the gentle idle rotation
        if (phase !== 'rain') {
            if (isDragging) {
                spinVel = clamp((rotY - prevRotY) / Math.max(dt, 0.001), -6, 6);
            } else {
                spinVel += (BASE_SPIN - spinVel) * Math.min(1, 2 * dt);
                rotY += spinVel * dt;
                const targetRotX = 0.25 + Math.sin(time * 0.8) * 0.1;
                rotX += (targetRotX - rotX) * Math.min(1, 3 * dt);
            }
        }
        prevRotY = rotY;

        for (let i = 0; i < NUM_POINTS; i++) {
            heartParticles[i].update(phase, progress, rotY, rotX, beatFactor, time, dt);
        }

        // Painter's algorithm: far particles first, near ones on top
        heartParticles.sort((a, b) => b.projZ - a.projZ);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        let lastFont = '';
        let lastColor = '';

        for (let i = 0; i < NUM_POINTS; i++) {
            const p = heartParticles[i];
            const zNorm = (p.projZ + 0.8) / 1.6;

            if (phase === 'beating' && zNorm > 0.55) continue;

            const size = p.fontSize * fontScale;

            if (phase !== 'beating' && p.trail.length > 1) {
                const trailLen = p.trail.length;
                ctx.font = `${p.weight} ${Math.max(5, Math.round(size * 0.7 * p.projScale))}px ${FONT}`;
                for (let j = 0; j < trailLen - 1; j++) {
                    const trailPos = p.trail[j];
                    const trailAlpha = (p.opacity * (j / trailLen) * 0.2).toFixed(2);
                    ctx.fillStyle = `rgba(255, 45, 85, ${trailAlpha})`;
                    ctx.fillText(p.text, trailPos.x, trailPos.y);
                }
                lastFont = '';
                lastColor = '';
            }

            const fontStr = `${p.weight} ${Math.max(7, Math.round(size * p.projScale))}px ${FONT}`;
            if (fontStr !== lastFont) {
                ctx.font = fontStr;
                lastFont = fontStr;
            }

            let r, g, b;
            if (phase === 'rain') {
                r = 255; g = 45; b = 85;
            } else if (zNorm < 0.5) {
                const t = zNorm * 2;
                r = 255; g = Math.round(45 + t * 45); b = Math.round(85 + t * 45);
            } else {
                const t = (zNorm - 0.5) * 2;
                r = Math.round(255 - t * 80); g = Math.round(90 - t * 40); b = Math.round(130 + t * 100);
            }

            let alpha = p.opacity * Math.max(0.15, 1.2 - zNorm);
            if (phase === 'beating' && zNorm > 0.45) {
                alpha *= (0.55 - zNorm) / 0.1;
            }

            const colorStr = `rgba(${r}, ${g}, ${b}, ${Math.max(0, alpha).toFixed(2)})`;
            if (colorStr !== lastColor) {
                ctx.fillStyle = colorStr;
                lastColor = colorStr;
            }

            ctx.fillText(p.text, p.projX, p.projY);
        }

        sparkles = sparkles.filter((s) => {
            s.update(f);
            s.draw();
            return s.alpha > 0;
        });

        const vignetteGlow = ctx.createRadialGradient(CX, CY, Math.min(W, H) * 0.3, CX, CY, Math.max(W, H) * 0.8);
        vignetteGlow.addColorStop(0, 'rgba(2, 0, 5, 0)');
        vignetteGlow.addColorStop(1, 'rgba(2, 0, 5, 0.7)');
        ctx.fillStyle = vignetteGlow;
        ctx.fillRect(0, 0, W, H);

        if (!msgShown && elapsed > RAIN_DURATION + 1000) {
            msgShown = true;
            els.msg.classList.add('active');
        }
        if (!hintDismissed && elapsed > RAIN_DURATION + ASSEMBLE_DURATION + 600) {
            els.tapHint.classList.add('show');
        }
    }

    requestAnimationFrame(loop);
})();
