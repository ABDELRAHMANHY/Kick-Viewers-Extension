(function() {
    // الاحتفاظ بنسخة من أداة الاتصال الأصلية للمتصفح
    const OriginalWebSocket = window.WebSocket;
    
    // استبدالها بأداتنا المعدلة
    window.WebSocket = function(url, protocols) {
        const ws = new OriginalWebSocket(url, protocols);
        
        // التنصت على كل رسالة تعبر من السيرفر إلى المتصفح
        ws.addEventListener('message', function(event) {
            if (typeof event.data === 'string' && event.data.includes('ChatMessageEvent')) {
                // إطلاق جرس إنذار للإضافة بأن هناك رسالة مرت للتو!
                document.dispatchEvent(new CustomEvent('KickRealtimeMessage'));
            }
        });
        
        return ws;
    };
    
    // التعديل الجديد: ضبط الـ prototype والوراثة بشكل كامل وصحيح للمتصفح
    Object.setPrototypeOf(window.WebSocket, OriginalWebSocket);
    window.WebSocket.prototype = OriginalWebSocket.prototype;
})();