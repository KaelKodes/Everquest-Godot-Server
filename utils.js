function send(ws, data) {
  try {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  } catch (e) {
    console.error('[ENGINE] Send error:', e.message);
  }
}

module.exports = {
  send
};
