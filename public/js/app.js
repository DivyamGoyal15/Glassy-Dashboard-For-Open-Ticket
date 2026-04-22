// ============ TOAST ============
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ============ SAVE ============
async function saveConfig(url) {
    const editor = document.getElementById('editor');
    const content = editor.value;
    try { JSON.parse(content); }
    catch (e) { return showToast('❌ Invalid JSON: ' + e.message, 'error'); }

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        const data = await res.json();
        showToast((data.success ? '✅ ' : '❌ ') + data.message, data.success ? 'success' : 'error');
        if (data.success) {
            const wrap = document.querySelector('.editor-wrap');
            if (wrap) {
                wrap.classList.add('save-flash');
                setTimeout(() => wrap.classList.remove('save-flash'), 600);
            }
        }
    } catch (e) {
        showToast('❌ Network error: ' + e.message, 'error');
    }
}

// ============ FORMAT JSON ============
function formatJson() {
    const el = document.getElementById('editor');
    try {
        el.value = JSON.stringify(JSON.parse(el.value), null, 4);
        showToast('✨ Formatted!');
    } catch (e) {
        showToast('❌ Invalid JSON', 'error');
    }
}

// ============ CTRL+S SHORTCUT ============
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const editor = document.getElementById('editor');
        if (editor) {
            const url = editor.dataset.saveUrl;
            if (url) saveConfig(url);
        }
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        if (document.getElementById('editor')) {
            e.preventDefault();
            formatJson();
        }
    }
});

// ============ SETUP TEMPLATE APPLY ============
async function applyTemplate(file) {
    if (!confirm(`Apply the default template for ${file}.json?\n\nThis will overwrite any existing content.`)) return;
    try {
        const res = await fetch(`/setup/apply/${file}`, { method: 'POST' });
        const data = await res.json();
        showToast((data.success ? '✅ ' : '❌ ') + data.message, data.success ? 'success' : 'error');
        if (data.success) setTimeout(() => location.reload(), 1200);
    } catch (e) {
        showToast('❌ ' + e.message, 'error');
    }
}

// ============ LIVE STATS ============
if (document.getElementById('live-stats')) {
    setInterval(async () => {
        try {
            const res = await fetch('/api/stats');
            const data = await res.json();
            const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
            set('stat-ping', data.ping + 'ms');
            set('stat-memory', data.memory + 'MB');
            set('stat-uptime', formatUptime(data.uptime));
        } catch (e) {}
    }, 5000);
}

function formatUptime(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
}

// ============ SIDEBAR TOGGLE ============
(function() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebar-toggle');
    const overlay = document.getElementById('sidebar-overlay');
    const hoverZone = document.getElementById('sidebar-hover-zone');

    if (!sidebar || !toggle) return;

    let isOpen = false;
    let hoverTimeout = null;

    function openSidebar() {
        isOpen = true;
        sidebar.classList.add('open');
        toggle.classList.add('active');
        if (overlay) overlay.classList.add('visible');
    }

    function closeSidebar() {
        isOpen = false;
        sidebar.classList.remove('open');
        toggle.classList.remove('active');
        if (overlay) overlay.classList.remove('visible');
    }

    toggle.addEventListener('click', () => {
        if (isOpen) closeSidebar();
        else openSidebar();
    });

    if (overlay) {
        overlay.addEventListener('click', closeSidebar);
    }

    // Hover zone opens sidebar
    if (hoverZone) {
        hoverZone.addEventListener('mouseenter', () => {
            hoverTimeout = setTimeout(openSidebar, 150);
        });
        hoverZone.addEventListener('mouseleave', () => {
            clearTimeout(hoverTimeout);
        });
    }

    // Close sidebar when mouse leaves sidebar area
    sidebar.addEventListener('mouseleave', (e) => {
        // Only auto-close if opened by hover, not by button click
        // We check if the toggle is not focused
        if (!toggle.matches(':hover')) {
            setTimeout(() => {
                if (!sidebar.matches(':hover') && !toggle.matches(':hover')) {
                    closeSidebar();
                }
            }, 300);
        }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen) closeSidebar();
    });
})();

// ============ CUSTOM CURSOR ============
(function() {
    const dot = document.querySelector('.cursor-dot');
    const ring = document.querySelector('.cursor-ring');
    if (!dot || !ring) return;

    let mouseX = 0, mouseY = 0;
    let ringX = 0, ringY = 0;

    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
        dot.style.left = mouseX + 'px';
        dot.style.top = mouseY + 'px';
    });

    function animateRing() {
        ringX += (mouseX - ringX) * 0.15;
        ringY += (mouseY - ringY) * 0.15;
        ring.style.left = ringX + 'px';
        ring.style.top = ringY + 'px';
        requestAnimationFrame(animateRing);
    }
    animateRing();

    document.addEventListener('mouseover', (e) => {
        if (e.target.closest('a, button, .btn, .nav-item, .plugin-card, .stat-card, input, textarea')) {
            ring.classList.add('hover');
        }
    });
    document.addEventListener('mouseout', (e) => {
        if (e.target.closest('a, button, .btn, .nav-item, .plugin-card, .stat-card, input, textarea')) {
            ring.classList.remove('hover');
        }
    });
})();

// ============ LOAD BOT FAVICON DYNAMICALLY ============
(async function() {
    try {
        const res = await fetch('/api/bot-info');
        if (!res.ok) return;
        const data = await res.json();
        if (data.avatar) {
            document.querySelectorAll("link[rel='icon']").forEach(el => el.remove());
            const link = document.createElement('link');
            link.rel = 'icon';
            link.href = data.avatar;
            document.head.appendChild(link);
        }
    } catch (e) {}
})();
