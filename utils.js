function send(ws, data) {
  try {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  } catch (e) {
    console.error('[ENGINE] Send error:', e.message);
  }
}

function getDistanceSq(x1, y1, x2, y2) {
    const dx = (x1 || 0) - (x2 || 0);
    const dy = (y1 || 0) - (y2 || 0);
    return dx * dx + dy * dy;
}

function getDistance(x1, y1, x2, y2) {
    return Math.sqrt(getDistanceSq(x1, y1, x2, y2));
}

module.exports = {
  send,
  getDistanceSq,
  getDistance
};
