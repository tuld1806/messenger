/**
 * Rate Limiter cho Socket.IO: giới hạn số lần MỘT socket được phát một event
 * trong một cửa sổ thời gian (mặc định: 5 tin nhắn / 1 giây / socket).
 *
 * Dùng trong io.on('connection'): attachSocketRateLimiter(socket)
 * Packet vượt hạn mức bị bỏ (handler không chạy); client nhận lỗi qua
 * callback (ack) và event 'rate_limited'.
 */
function attachSocketRateLimiter(
  socket,
  { events = ['send_message'], maxEvents = 5, windowMs = 1000 } = {}
) {
  const watched = new Set(events);
  const timestamps = []; // thời điểm các event gần nhất của socket này

  socket.use((packet, next) => {
    const [eventName, ...args] = packet;
    if (!watched.has(eventName)) return next();

    const now = Date.now();
    while (timestamps.length && now - timestamps[0] >= windowMs) {
      timestamps.shift();
    }

    if (timestamps.length < maxEvents) {
      timestamps.push(now);
      return next();
    }

    const payload = {
      success: false,
      code: 'RATE_LIMITED',
      message: 'Bạn đang gửi tin nhắn quá nhanh, vui lòng chờ 1 giây.',
      retryAfterMs: windowMs - (now - timestamps[0]),
    };

    const ack = args[args.length - 1];
    if (typeof ack === 'function') ack(payload);
    socket.emit('rate_limited', { event: eventName, ...payload });
    // Không gọi next(): packet bị loại bỏ.
  });
}

module.exports = { attachSocketRateLimiter };
