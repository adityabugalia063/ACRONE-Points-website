// Server-Sent Events (SSE) Manager for Acrone Collection

class SseService {
  constructor() {
    // Map of publicPlayerId -> Set of response objects
    this.clients = new Map();

    // Heartbeat every 25 seconds to keep intermediary connections/proxies alive
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 25000);
    this.heartbeatInterval.unref();
  }

  addClient(publicPlayerId, res) {
    if (!this.clients.has(publicPlayerId)) {
      this.clients.set(publicPlayerId, new Set());
    }
    const playerClients = this.clients.get(publicPlayerId);
    playerClients.add(res);

    // Initial connection acknowledgement
    res.write(`event: connected\ndata: ${JSON.stringify({
      message: `Subscribed to real-time collection updates for ${publicPlayerId}`,
      connectedAt: Date.now()
    })}\n\n`);

    // Handle connection closure
    res.on('close', () => {
      this.removeClient(publicPlayerId, res);
    });
  }

  removeClient(publicPlayerId, res) {
    const playerClients = this.clients.get(publicPlayerId);
    if (playerClients) {
      playerClients.delete(res);
      if (playerClients.size === 0) {
        this.clients.delete(publicPlayerId);
      }
    }
  }

  broadcastToPlayer(publicPlayerId, eventType, data) {
    const playerClients = this.clients.get(publicPlayerId);
    if (!playerClients || playerClients.size === 0) return;

    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of playerClients) {
      try {
        client.write(payload);
      } catch (err) {
        this.removeClient(publicPlayerId, client);
      }
    }
  }

  sendHeartbeat() {
    const comment = `: heartbeat ${Date.now()}\n\n`;
    for (const [publicPlayerId, set] of this.clients.entries()) {
      for (const res of set) {
        try {
          res.write(comment);
        } catch (err) {
          this.removeClient(publicPlayerId, res);
        }
      }
    }
  }

  getActiveSubscriberCount(publicPlayerId) {
    const set = this.clients.get(publicPlayerId);
    return set ? set.size : 0;
  }
}

export const sseService = new SseService();
