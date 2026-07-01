(function() {
    // الاحتفاظ بنسخة من أداة الاتصال الأصلية للمتصفح
    const OriginalWebSocket = window.WebSocket;
    
    // استبدالها بأداتنا المعدلة
    window.WebSocket = function(url, protocols) {
        const ws = new OriginalWebSocket(url, protocols);
        
        // التنصت على كل رسالة تعبر من السيرفر إلى المتصفح
        ws.addEventListener('message', function(event) {
            if (typeof event.data === 'string' && event.data.includes('ChatMessageEvent')) {
                try {
                    const outer = JSON.parse(event.data);
                    const inner = JSON.parse(outer.data);
                    // استخراج اسم المرسل وتمريره مع الحدث
                    const username = inner?.sender?.username || null;
                    document.dispatchEvent(new CustomEvent('KickRealtimeMessage', {
                        detail: { username }
                    }));
                } catch (e) {
                    // fallback بدون اسم إذا فشل التحليل
                    document.dispatchEvent(new CustomEvent('KickRealtimeMessage', {
                        detail: { username: null }
                    }));
                }
            }
        });
        
        return ws;
    };
    
    // ضبط الـ prototype والوراثة بشكل كامل وصحيح للمتصفح
    Object.setPrototypeOf(window.WebSocket, OriginalWebSocket);
    window.WebSocket.prototype = OriginalWebSocket.prototype;
})();