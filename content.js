(function () {
  "use strict";
  console.log("🟢 [Kick Ext] تم بدء تشغيل ملف content.js بنجاح.");

  // ==========================================
  // 1. زراعة الجاسوس
  // ==========================================
  // يجب حقن كود المراقبة بشكل متزامن (sync) وقبل أي كود آخر في الصفحة،
  // لأن الاستبدال يعتمد على استبدال window.WebSocket قبل أن تفتح صفحة
  // Kick اتصال الشات الخاص بها. لذلك الكود مضمّن هنا مباشرة كنص ثابت
  // (نفس محتوى spy.js حرفياً) بدل تحميله عبر src أو XHR، فينفَّذ فوراً
  // ومتزامناً عند إلحاقه بالـ DOM، مع "run_at": "document_start" في
  // manifest.json لضمان أبكر توقيت ممكن.
  try {
    const script = document.createElement('script');
    script.textContent = `(function() {
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
        const ws = new OriginalWebSocket(url, protocols);
        ws.addEventListener('message', function(event) {
            if (typeof event.data === 'string' && event.data.includes('ChatMessageEvent')) {
                try {
                    const outer = JSON.parse(event.data);
                    const inner = JSON.parse(outer.data);
                    const username = inner?.sender?.username || null;
                    document.dispatchEvent(new CustomEvent('KickRealtimeMessage', {
                        detail: { username }
                    }));
                } catch (e) {
                    document.dispatchEvent(new CustomEvent('KickRealtimeMessage', {
                        detail: { username: null }
                    }));
                }
            }
        });
        return ws;
    };
    Object.setPrototypeOf(window.WebSocket, OriginalWebSocket);
    window.WebSocket.prototype = OriginalWebSocket.prototype;
})();`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
    console.log("🟢 [Kick Ext] تم حقن كود المراقبة بنجاح.");
  } catch (e) {
    console.warn("🔴 [Kick Ext] فشل حقن كود المراقبة، سيتم تعطيل عدّاد الرسائل:", e);
  }

  // ==========================================
  // 2. الثوابت والإعدادات
  // ==========================================
  const VIEWERS_BADGE_ID = "kick-real-viewers-badge";
  const CHAT_BADGE_ID    = "kick-chat-counter-badge";
  const TIMER_BADGE_ID   = "kick-session-timer-badge";
  const UPDATE_INTERVAL  = 5000;

  const SHARE_BUTTON_SELECTORS = [
    '[data-testid="share-button"]',
    'button[aria-label*="share" i]',
    'button[aria-label*="شارك" i]',
    'button[aria-label*="compartir" i]',
    'button[aria-label*="partager" i]',
    'button[aria-label*="teilen" i]',
    'button[aria-label*="paylaş" i]',
    'button[aria-label*="поделиться" i]',
  ];

  const LABELS = {
    ar: { viewers: "مشاهد", messages: "رسالة", chatters: "كاتب", timer: "وقت المشاهدة" },
    en: { viewers: "Viewers", messages: "Messages", chatters: "Chatters", timer: "Watch Time" },
    es: { viewers: "Espectadores", messages: "Mensajes", chatters: "Participantes", timer: "Tiempo" },
    fr: { viewers: "Spectateurs",  messages: "Messages", chatters: "Membres", timer: "Temps" },
    de: { viewers: "Zuschauer",    messages: "Nachrichten", chatters: "Chatter", timer: "Uhrzeit" },
    tr: { viewers: "İzleyici",     messages: "Mesaj", chatters: "Kişi", timer: "Süre" },
    ru: { viewers: "Зрителей",     messages: "Сообщений", chatters: "Участников", timer: "Время" },
    ko: { viewers: "시청자",        messages: "메시지", chatters: "참여자", timer: "시간" },
    ja: { viewers: "視聴者",        messages: "メッセージ", chatters: "参加者", timer: "時間" },
  };

  function getLabel(type) {
    const lang = document.documentElement.lang?.slice(0, 2)
              || navigator.language?.slice(0, 2)
              || "en";
    return (LABELS[lang] ?? LABELS["en"])[type];
  }

  // ==========================================
  // 3. متغيرات الحالة
  // ==========================================
  let sessionMsgCount    = 0;
  let uniqueChatters     = new Set();
  let sessionStartTime   = null; 
  let viewersInterval    = null;
  let uiUpdateInterval   = null;
  let fetchController    = null; 
  let currentChannelName = null; 

  let cfg = { showViewers: true, showChat: true, showTimer: true };

  // ==========================================
  // 4. دوال مساعدة
  // ==========================================
  function getChannelNameFromUrl() {
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (pathParts.length === 0) return null;
    const name = pathParts[0];
    const ignoreList = [
      'categories', 'search', 'following', 'auth', 'dashboard', 'video', 'clip',
      'browse', 'subscriptions', 'wallet', 'settings', 'notifications',
      'moderator', 'support', 'about', 'privacy', 'terms', 'jobs', 'store',
      'signup', 'login', 'embed-chat', 'discover', 'leaderboards'
    ];
    return ignoreList.includes(name) ? null : name;
  }

  function findShareButton() {
    for (const sel of SHARE_BUTTON_SELECTORS) {
      const btn = document.querySelector(sel);
      if (btn) return btn;
    }
    return null;
  }

  function createSVG(width, height, viewBox, paths) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("fill", "#aeb2b9");
    svg.style.cssText = "flex-shrink:0; margin: 0;";
    for (const d of paths) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    }
    return svg;
  }

  // ==========================================
  // 5. تحديث شارة الرسائل والكتاب (بأداء عالي وثبات)
  // ==========================================
  function updateChatBadge(msgCount, chattersCount) {
    if (!cfg.showChat) {
      document.getElementById(CHAT_BADGE_ID)?.remove();
      return;
    }
    const shareButton = findShareButton();
    if (!shareButton) return;

    let badge = document.getElementById(CHAT_BADGE_ID);
    
    // بناء الهيكل لمرة واحدة فقط
    if (!badge) {
      badge = document.createElement("div");
      badge.id = CHAT_BADGE_ID;
      Object.assign(badge.style, {
        display: "inline-flex",
        alignItems: "center",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "19px",
        fontWeight: "bold",
        margin: "0 12px",
        gap: "8px",
        direction: "rtl" // تثبيت الاتجاه الرئيسي لمنع الرقص
      });

      const icon = createSVG("18", "18", "0 0 24 24", [
        "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"
      ]);

      // قسم الرسائل
      const msgBlock = document.createElement("div");
      msgBlock.style.cssText = "display:flex; align-items:center; gap:4px;";
      
      const msgNum = document.createElement("span");
      msgNum.id = "kick-msg-num";
      msgNum.style.color = "#53fc18";
      msgNum.dir = "ltr"; // إجبار الأرقام على اتجاه ثابت
      
      const msgLbl = document.createElement("span");
      msgLbl.id = "kick-msg-lbl";
      msgLbl.style.cssText = "color:#aeb2b9; font-size:16px;";
      
      msgBlock.append(msgNum, msgLbl);

      // الفاصل
      const dot = document.createElement("span");
      dot.textContent = "•";
      dot.style.color = "#aeb2b9";

      // قسم الكتاب (الأشخاص)
      const chattersBlock = document.createElement("div");
      chattersBlock.style.cssText = "display:flex; align-items:center; gap:4px;";

      const chattersNum = document.createElement("span");
      chattersNum.id = "kick-chatters-num";
      chattersNum.style.color = "#53fc18";
      chattersNum.dir = "ltr"; 
      
      const chattersLbl = document.createElement("span");
      chattersLbl.id = "kick-chatters-lbl";
      chattersLbl.style.cssText = "color:#aeb2b9; font-size:16px;";

      chattersBlock.append(chattersNum, chattersLbl);

      badge.append(icon, msgBlock, dot, chattersBlock);
      shareButton.insertAdjacentElement("beforebegin", badge);
    }

    // تحديث المحتوى النصي فقط (لا يستهلك موارد الجهاز)
    document.getElementById("kick-msg-num").textContent = msgCount.toLocaleString();
    document.getElementById("kick-msg-lbl").textContent = getLabel("messages");
    
    document.getElementById("kick-chatters-num").textContent = chattersCount.toLocaleString();
    document.getElementById("kick-chatters-lbl").textContent = getLabel("chatters");
  }

  // ==========================================
  // 6. تحديث شارة المشاهدين (مُحسّن)
  // ==========================================
  function updateViewersBadge(count) {
    if (!cfg.showViewers) {
      document.getElementById(VIEWERS_BADGE_ID)?.remove();
      return;
    }
    const shareButton = findShareButton();
    if (!shareButton) return;

    const anchorEl = document.getElementById(CHAT_BADGE_ID) ?? shareButton;
    let badge = document.getElementById(VIEWERS_BADGE_ID);
    
    if (!badge) {
      badge = document.createElement("div");
      badge.id = VIEWERS_BADGE_ID;
      Object.assign(badge.style, {
        display: "inline-flex",
        alignItems: "center",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "19px",
        fontWeight: "bold",
        margin: "0 12px",
        gap: "6px",
        direction: "rtl"
      });

      const icon = createSVG("20", "20", "0 0 32 32", [
        "M4 19V28H7V22H16V28H28V19H4Z",
        "M10.75 17.5C14.4775 17.5 17.5 14.4775 17.5 10.75C17.5 7.0225 14.4775 4 10.75 4C7.0225 4 4 7.0225 4 10.75C4 14.4775 7.0225 17.5 10.75 17.5ZM10.75 7C12.82 7 14.5 8.68 14.5 10.75C14.5 12.82 12.82 14.5 10.75 14.5C8.68 14.5 7 12.82 7 10.75C7 8.68 8.68 7 10.75 7Z",
        "M23.5 17.5C25.9853 17.5 28 15.4853 28 13C28 10.5147 25.9853 8.5 23.5 8.5C21.0147 8.5 19 10.5147 19 13C19 15.4853 21.0147 17.5 23.5 17.5Z"
      ]);

      const numEl = document.createElement("span");
      numEl.id = "kick-viewers-val";
      numEl.style.color = "#53fc18";
      numEl.dir = "ltr";

      const label = document.createElement("span");
      label.id = "kick-viewers-lbl";
      label.style.cssText = "color:#aeb2b9; font-size:16px;";

      badge.append(icon, numEl, label);
      anchorEl.insertAdjacentElement("beforebegin", badge);
    }

    document.getElementById("kick-viewers-val").textContent =
      (count === null || count === undefined) ? "—" : count.toLocaleString();
    document.getElementById("kick-viewers-lbl").textContent = getLabel("viewers");
  }

  // ==========================================
  // 7. المؤقت (مُحسّن)
  // ==========================================
  function formatElapsed(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function updateTimerBadge() {
    if (!cfg.showTimer || !sessionStartTime) {
      document.getElementById(TIMER_BADGE_ID)?.remove();
      return;
    }
    const shareButton = findShareButton();
    if (!shareButton) return;

    const anchorEl = document.getElementById(VIEWERS_BADGE_ID)
                  ?? document.getElementById(CHAT_BADGE_ID)
                  ?? shareButton;

    let badge = document.getElementById(TIMER_BADGE_ID);
    if (!badge) {
      badge = document.createElement("div");
      badge.id = TIMER_BADGE_ID;
      Object.assign(badge.style, {
        display: "inline-flex",
        alignItems: "center",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "19px",
        fontWeight: "bold",
        margin: "0 12px",
        gap: "6px",
        direction: "rtl"
      });

      const icon = createSVG("17", "17", "0 0 24 24", [
        "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm.5 5v6l4.5 2.7-.75 1.23L11 13V7h1.5z"
      ]);

      const numEl = document.createElement("span");
      numEl.id = "kick-timer-val";
      numEl.style.color = "#53fc18";
      numEl.dir = "ltr";

      const label = document.createElement("span");
      label.id = "kick-timer-lbl";
      label.style.cssText = "color:#aeb2b9; font-size:16px;";

      badge.append(icon, numEl, label);
      anchorEl.insertAdjacentElement("beforebegin", badge);
    }

    document.getElementById("kick-timer-val").textContent = formatElapsed(Date.now() - sessionStartTime);
    document.getElementById("kick-timer-lbl").textContent = getLabel("timer");
  }

  // ==========================================
  // 8. استقبال رسائل الشات من الجاسوس
  // ==========================================
  document.addEventListener('KickRealtimeMessage', (event) => {
    if (sessionMsgCount < 999999) {
      sessionMsgCount++;
    }
    const username = event.detail?.username;
    if (username) uniqueChatters.add(username);
  });

  // ==========================================
  // 9. جلب المشاهدين من الـ API
  // ==========================================
  // ملاحظة: /api/v1/channels/{slug} هو مسار داخلي غير موثّق رسمياً من Kick
  // (وليس جزءاً من الـ API الرسمي المبني على OAuth على api.kick.com)، لذلك
  // قد يتغير أو يُحجب دون إشعار مسبق. للتعامل مع هذا الاحتمال، لا نترك
  // الرقم القديم معروضاً بشكل مضلِّل عند تكرر الفشل، بل نعرض "—" بدلاً منه.
  let viewersFailCount = 0;
  const VIEWERS_FAIL_THRESHOLD = 2;

  async function fetchLiveViewerCountAPI() {
    if (!cfg.showViewers) return;

    const channelName = getChannelNameFromUrl(); 
    if (!channelName) return;

    fetchController?.abort();
    fetchController = new AbortController();

    try {
      const response = await fetch(
        `https://kick.com/api/v1/channels/${channelName}`,
        { signal: fetchController.signal }
      );
      if (response.ok) {
        const data = await response.json();
        if (data?.livestream?.viewer_count !== undefined) {
          viewersFailCount = 0;
          updateViewersBadge(data.livestream.viewer_count);
        } else {
          // القناة موجودة لكن الاستجابة لا تحتوي على بث مباشر (ليست حالة خطأ)
          viewersFailCount = 0;
        }
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        viewersFailCount++;
        console.warn("[Kick Ext] فشل جلب بيانات المشاهدين:", err);
        if (viewersFailCount >= VIEWERS_FAIL_THRESHOLD) {
          updateViewersBadge(null); // اعرض "—" بدل رقم قديم قد يكون مضللاً
        }
      }
    }
  }

  // ==========================================
  // 10. التشغيل والإيقاف
  // ==========================================
  function startIntervals() {
    if (uiUpdateInterval) clearInterval(uiUpdateInterval);
    if (viewersInterval)  clearInterval(viewersInterval);

    if (!sessionStartTime) sessionStartTime = Date.now();
    currentChannelName = getChannelNameFromUrl(); 

    uiUpdateInterval = setInterval(() => {
      const newChannel = getChannelNameFromUrl();
      if (newChannel && newChannel !== currentChannelName) {
        currentChannelName = newChannel;
        sessionMsgCount = 0;
        uniqueChatters.clear();
        viewersFailCount = 0;
      }

      updateChatBadge(sessionMsgCount, uniqueChatters.size);
      updateTimerBadge(); 
    }, 1000);

    fetchLiveViewerCountAPI();
    viewersInterval = setInterval(fetchLiveViewerCountAPI, UPDATE_INTERVAL);
  }

  function stopAll() {
    clearInterval(uiUpdateInterval);
    clearInterval(viewersInterval);
    fetchController?.abort();

    uiUpdateInterval   = null;
    viewersInterval    = null;
    fetchController    = null;
    sessionStartTime   = null;
    currentChannelName = null;

    document.getElementById(VIEWERS_BADGE_ID)?.remove();
    document.getElementById(CHAT_BADGE_ID)?.remove();
    document.getElementById(TIMER_BADGE_ID)?.remove();

    sessionMsgCount = 0;
    uniqueChatters.clear();
  }

  // ==========================================
  // 11. تطبيق الإعدادات
  // ==========================================
  function applySettings(showViewers, showChat, showTimer) {
    cfg.showViewers = showViewers;
    cfg.showChat    = showChat;
    cfg.showTimer   = showTimer;

    const anyActive = showViewers || showChat || showTimer;

    if (!anyActive) {
      stopAll();
      return;
    }

    if (!uiUpdateInterval && !viewersInterval) {
      startIntervals();
    }

    if (!showViewers) document.getElementById(VIEWERS_BADGE_ID)?.remove();
    if (!showChat)    document.getElementById(CHAT_BADGE_ID)?.remove();
    if (!showTimer)   document.getElementById(TIMER_BADGE_ID)?.remove();
  }

  // ==========================================
  // 12. قراءة الإعدادات
  // ==========================================
  const run = () => {
    if (typeof chrome !== "undefined" && chrome?.storage?.local) {
      chrome.storage.local.get(['showViewers', 'showChat', 'showTimer'], (res) => {
        const showViewers = res.showViewers !== false;
        const showChat    = res.showChat    !== false;
        const showTimer   = res.showTimer   !== false;
        applySettings(showViewers, showChat, showTimer);
      });

      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;
        const showViewers = 'showViewers' in changes ? changes.showViewers.newValue : cfg.showViewers;
        const showChat    = 'showChat'    in changes ? changes.showChat.newValue    : cfg.showChat;
        const showTimer   = 'showTimer'   in changes ? changes.showTimer.newValue   : cfg.showTimer;
        applySettings(showViewers, showChat, showTimer);
      });
    } else {
      startIntervals();
    }
  };

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "resetChat") {
        sessionMsgCount = 0;
        uniqueChatters.clear();
        updateChatBadge(sessionMsgCount, uniqueChatters.size);
        sendResponse({ status: "success" });
      } else if (request.action === "resetTimer") {
        sessionStartTime = Date.now();
        updateTimerBadge();
        sendResponse({ status: "success" });
      }
    });
  }

  run();
  window.addEventListener("pagehide", stopAll);

})();