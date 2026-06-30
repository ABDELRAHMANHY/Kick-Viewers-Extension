document.addEventListener('DOMContentLoaded', () => {
  const toggleViewers = document.getElementById('toggleViewers');
  const toggleChat    = document.getElementById('toggleChat');
  const toggleTimer   = document.getElementById('toggleTimer');
  const viewersStatus = document.getElementById('viewersStatus');
  const chatStatus    = document.getElementById('chatStatus');
  const timerStatus   = document.getElementById('timerStatus');
  
  // الأزرار الجديدة المنفصلة
  const resetChatBtn  = document.getElementById('resetChatBtn');
  const resetTimerBtn = document.getElementById('resetTimerBtn');

  // قراءة الحالات الثلاث من الذاكرة
  chrome.storage.local.get(['showViewers', 'showChat', 'showTimer'], (result) => {
    const showViewers = result.showViewers !== false;
    const showChat    = result.showChat    !== false;
    const showTimer   = result.showTimer   !== false;

    toggleViewers.checked = showViewers;
    toggleChat.checked    = showChat;
    toggleTimer.checked   = showTimer;

    updateStatus(viewersStatus, showViewers);
    updateStatus(chatStatus,    showChat);
    updateStatus(timerStatus,   showTimer);
  });

  toggleViewers.addEventListener('change', () => {
    const val = toggleViewers.checked;
    chrome.storage.local.set({ showViewers: val });
    updateStatus(viewersStatus, val);
  });

  toggleChat.addEventListener('change', () => {
    const val = toggleChat.checked;
    chrome.storage.local.set({ showChat: val });
    updateStatus(chatStatus, val);
  });

  toggleTimer.addEventListener('change', () => {
    const val = toggleTimer.checked;
    chrome.storage.local.set({ showTimer: val });
    updateStatus(timerStatus, val);
  });

  // برمجة زر تصفير الرسائل فقط
  resetChatBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "resetChat" }, (response) => {
          if (response && response.status === "success") {
            const originalText = resetChatBtn.textContent;
            resetChatBtn.textContent = "تم تصفير الرسائل ✓";
            resetChatBtn.style.backgroundColor = "#53fc18";
            resetChatBtn.style.color = "#0b0e14";
            resetChatBtn.style.borderColor = "#53fc18";
            
            setTimeout(() => {
              resetChatBtn.textContent = originalText;
              resetChatBtn.style.backgroundColor = "#1e2330";
              resetChatBtn.style.color = "#aeb2b9";
              resetChatBtn.style.borderColor = "#3a3f4a";
            }, 1500);
          }
        });
      }
    });
  });

  // برمجة زر تصفير الوقت فقط
  resetTimerBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "resetTimer" }, (response) => {
          if (response && response.status === "success") {
            const originalText = resetTimerBtn.textContent;
            resetTimerBtn.textContent = "تم تصفير الوقت ✓";
            resetTimerBtn.style.backgroundColor = "#53fc18";
            resetTimerBtn.style.color = "#0b0e14";
            resetTimerBtn.style.borderColor = "#53fc18";
            
            setTimeout(() => {
              resetTimerBtn.textContent = originalText;
              resetTimerBtn.style.backgroundColor = "#1e2330";
              resetTimerBtn.style.color = "#aeb2b9";
              resetTimerBtn.style.borderColor = "#3a3f4a";
            }, 1500);
          }
        });
      }
    });
  });

  function updateStatus(el, isActive) {
    el.textContent = isActive ? "مفعّل" : "معطّل";
    el.style.color = isActive ? "#53fc18" : "#6b7280";
  }
});