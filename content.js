(function () {
  "use strict";
  console.log("🟢 [Kick Ext] تم بدء تشغيل ملف content.js بنجاح.");

  // ==========================================
  // 1. زراعة الجاسوس
  // ==========================================
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('spy.js');
  script.onload = function() {
    this.remove();
    console.log("🟢 [Kick Ext] تم حقن ملف spy.js بنجاح.");
  };
  (document.head || document.documentElement).appendChild(script);

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
    ar: { viewers: "مشاهد", messages: "رسالة"        },
    en: { viewers: "Viewers", messages: "Messages"    },
    es: { viewers: "Espectadores", messages: "Mensajes" },
    fr: { viewers: "Spectateurs",  messages: "Messages" },
    de: { viewers: "Zuschauer",    messages: "Nachrichten" },
    tr: { viewers: "İzleyici",     messages: "Mesaj"   },
    ru: { viewers: "Зрителей",     messages: "Сообщений" },
    ko: { viewers: "시청자",        messages: "메시지"   },
    ja: { viewers: "視聴者",        messages: "メッセージ" },
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
  let sessionStartTime   = null; 
  let viewersInterval    = null;
  let uiUpdateInterval   = null;
  let fetchController    = null; 
  let currentChannelName = null; // <-- (الجديد) متغير لحفظ اسم القناة الحالية

  // الإعدادات المحلية (تُحدَّث من chrome.storage)
  let cfg = { showViewers: true, showChat: true, showTimer: true };

  // ==========================================
  // 4. دوال مساعدة
  // ==========================================
  
  // (الجديد) دالة لاستخراج اسم القناة من الرابط وتجاهل الصفحات العامة
  function getChannelNameFromUrl() {
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (pathParts.length === 0) return null;
    const name = pathParts[0];
    const ignoreList = ['categories', 'search', 'following', 'auth', 'dashboard', 'video', 'clip'];
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
    svg.style.cssText = "margin-left:6px; flex-shrink:0;";
    for (const d of paths) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    }
    return svg;
  }

  function getOrCreateBadge(id, insertBefore) {
    let badge = document.getElementById(id);
    if (!badge) {
      badge = document.createElement("div");
      badge.id = id;
      Object.assign(badge.style, {
        display:    "inline-flex",
        alignItems: "center",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize:   "19px",
        fontWeight: "bold",
        margin:     "0 12px",
      });
      insertBefore.insertAdjacentElement("beforebegin", badge);
    }
    return badge;
  }

  function renderBadge(badge, icon, text, labelText) {
    const num = document.createElement("span");
    num.textContent = text;
    num.style.cssText = "color:#53fc18; margin: 0 6px;";
    const label = document.createElement("span");
    label.textContent = labelText;
    label.style.color = "#aeb2b9";
    badge.replaceChildren(icon, num, label);
  }

  // ==========================================
  // 5. المؤقت — حساب الوقت بدون interval إضافي
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

    const badge = getOrCreateBadge(TIMER_BADGE_ID, anchorEl);

    let numEl = badge.querySelector('.timer-num');
    if (!numEl) {
      const icon = createSVG("17", "17", "0 0 24 24", [
        "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm.5 5v6l4.5 2.7-.75 1.23L11 13V7h1.5z"
      ]);
      numEl = document.createElement("span");
      numEl.className = "timer-num";
      numEl.style.cssText = "color:#53fc18; margin: 0 6px;";
      const label = document.createElement("span");
      label.style.color = "#aeb2b9";
      label.textContent = "وقت المشاهدة";
      badge.replaceChildren(icon, numEl, label);
    }

    numEl.textContent = formatElapsed(Date.now() - sessionStartTime);
  }

  // ==========================================
  // 6. تحديث شارة المشاهدين
  // ==========================================
  function updateViewersBadge(count) {
    if (!cfg.showViewers) {
      document.getElementById(VIEWERS_BADGE_ID)?.remove();
      return;
    }
    const shareButton = findShareButton();
    if (!shareButton) return;

    const anchorEl = document.getElementById(CHAT_BADGE_ID) ?? shareButton;
    const badge    = getOrCreateBadge(VIEWERS_BADGE_ID, anchorEl);
    renderBadge(
      badge,
      createSVG("20", "20", "0 0 32 32", [
        "M4 19V28H7V22H16V28H28V19H4Z",
        "M10.75 17.5C14.4775 17.5 17.5 14.4775 17.5 10.75C17.5 7.0225 14.4775 4 10.75 4C7.0225 4 4 7.0225 4 10.75C4 14.4775 7.0225 17.5 10.75 17.5ZM10.75 7C12.82 7 14.5 8.68 14.5 10.75C14.5 12.82 12.82 14.5 10.75 14.5C8.68 14.5 7 12.82 7 10.75C7 8.68 8.68 7 10.75 7Z",
        "M23.5 17.5C25.9853 17.5 28 15.4853 28 13C28 10.5147 25.9853 8.5 23.5 8.5C21.0147 8.5 19 10.5147 19 13C19 15.4853 21.0147 17.5 23.5 17.5Z",
      ]),
      count.toLocaleString(),
      getLabel("viewers")
    );
  }

  // ==========================================
  // 7. تحديث شارة الرسائل
  // ==========================================
  function updateChatBadge(count) {
    if (!cfg.showChat) {
      document.getElementById(CHAT_BADGE_ID)?.remove();
      return;
    }
    const shareButton = findShareButton();
    if (!shareButton) return;

    const badge = getOrCreateBadge(CHAT_BADGE_ID, shareButton);
    renderBadge(
      badge,
      createSVG("18", "18", "0 0 24 24", [
        "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z",
      ]),
      count.toLocaleString(),
      getLabel("messages")
    );
  }

  // ==========================================
  // 8. استقبال رسائل الشات من الجاسوس
  // ==========================================
  document.addEventListener('KickRealtimeMessage', () => {
    if (sessionMsgCount < 999999) {
      sessionMsgCount++;
    }
  });

  // ==========================================
  // 9. جلب المشاهدين من الـ API مع AbortController
  // ==========================================
  async function fetchLiveViewerCountAPI() {
    if (!cfg.showViewers) return;

    const channelName = getChannelNameFromUrl(); // تم استخدام الدالة الجديدة هنا
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
          updateViewersBadge(data.livestream.viewer_count);
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn("[Kick Ext] فشل جلب بيانات المشاهدين:", err);
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
    currentChannelName = getChannelNameFromUrl(); // تسجيل اسم القناة عند البداية

    uiUpdateInterval = setInterval(() => {
      // (الجديد) التحقق من تغيير القناة
      const newChannel = getChannelNameFromUrl();
      if (newChannel && newChannel !== currentChannelName) {
        // المستخدم انتقل لبث آخر! نصفّر الرسائل فقط ونحدث اسم القناة
        currentChannelName = newChannel;
        sessionMsgCount = 0;
      }

      updateChatBadge(sessionMsgCount);
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
    currentChannelName = null; // تصفير متغير القناة عند التوقف

    document.getElementById(VIEWERS_BADGE_ID)?.remove();
    document.getElementById(CHAT_BADGE_ID)?.remove();
    document.getElementById(TIMER_BADGE_ID)?.remove();

    sessionMsgCount = 0;
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
  // 12. قراءة الإعدادات والاستماع لتغيّراتها
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
      console.warn("⚠️ [Kick Ext] chrome.storage غير متاح، التشغيل بالوضع الافتراضي.");
      startIntervals();
    }
  };

  // ==========================================
  // 13. استقبال أوامر منفصلة لتصفيير العدادات
  // ==========================================
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "resetChat") {
        sessionMsgCount = 0;
        updateChatBadge(sessionMsgCount);
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