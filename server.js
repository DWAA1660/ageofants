const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

// Simple WebSocket backend for Ant Empire multiplayer lobbies.
// Responsibilities:
// - Create and join lobbies via short codes
// - Relay arbitrary JSON messages between all clients in the same lobby
// - Track basic player IDs within each lobby
//
// NOTE: This server does NOT yet run the game simulation. It is a message relay
// and lobby manager. The browser clients are expected to handle the actual game
// logic and use this server to synchronize state/commands.

const PORT = process.env.PORT || 3361;

/**
 * Lobby structure:
 * code: string -> {
 *   code: string,
 *   clients: Map<ws, { id: string }>
 * }
 */
const lobbies = new Map();

function generateLobbyCode() {
  // 6-character uppercase code, e.g. ABCD12
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    const idx = crypto.randomInt(0, alphabet.length);
    code += alphabet[idx];
  }
  return code;
}

function createLobby() {
  let code;
  do {
    code = generateLobbyCode();
  } while (lobbies.has(code));

  const lobby = {
    code,
    clients: new Map(),
  };
  lobbies.set(code, lobby);
  return lobby;
}

function joinLobby(code, ws, playerInfo) {
  const lobby = lobbies.get(code);
  if (!lobby) return null;

  lobby.clients.set(ws, playerInfo);
  ws.lobbyCode = code;
  ws.playerId = playerInfo.id;

  // Notify others that a player joined
  broadcastToLobby(lobby, {
    type: 'PLAYER_JOINED',
    code,
    playerId: playerInfo.id,
  }, ws);

  return lobby;
}

function leaveLobby(ws) {
  const code = ws.lobbyCode;
  if (!code) return;
  const lobby = lobbies.get(code);
  if (!lobby) return;

  const playerInfo = lobby.clients.get(ws);
  lobby.clients.delete(ws);

  if (playerInfo) {
    broadcastToLobby(lobby, {
      type: 'PLAYER_LEFT',
      code,
      playerId: playerInfo.id,
    }, ws);
  }

  if (lobby.clients.size === 0) {
    lobbies.delete(code);
  }

  ws.lobbyCode = null;
  ws.playerId = null;
}

function broadcastToLobby(lobby, message, excludeWs = null) {
  const payload = JSON.stringify(message);
  lobby.clients.forEach((info, client) => {
    if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
      client.send(payload);
    }
  });
}

const server = http.createServer();
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.lobbyCode = null;
  ws.playerId = null;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid JSON message' }));
      return;
    }

    const type = msg.type;

    if (type === 'PING') {
      ws.send(JSON.stringify({ type: 'PONG' }));
      return;
    }

    if (type === 'CREATE_LOBBY') {
      const lobby = createLobby();
      const playerId = crypto.randomBytes(8).toString('hex');
      lobby.clients.set(ws, { id: playerId });
      ws.lobbyCode = lobby.code;
      ws.playerId = playerId;
      ws.send(JSON.stringify({
        type: 'LOBBY_CREATED',
        code: lobby.code,
        playerId,
      }));
      return;
    }

    if (type === 'JOIN_LOBBY') {
      const code = (msg.code || '').toUpperCase();
      const lobby = lobbies.get(code);
      if (!lobby) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Lobby not found', code }));
        return;
      }
      const playerId = crypto.randomBytes(8).toString('hex');
      joinLobby(code, ws, { id: playerId });
      ws.send(JSON.stringify({
        type: 'LOBBY_JOINED',
        code,
        playerId,
      }));

      // Send current players list to the new client
      const players = Array.from(lobby.clients.values()).map(p => p.id);
      ws.send(JSON.stringify({
        type: 'LOBBY_PLAYERS',
        code,
        players,
      }));
      return;
    }

    // Relay arbitrary game messages inside a lobby
    if (type === 'GAME_MESSAGE') {
      const code = ws.lobbyCode;
      if (!code) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Not in a lobby' }));
        return;
      }
      const lobby = lobbies.get(code);
      if (!lobby) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Lobby no longer exists' }));
        return;
      }
      const payload = {
        type: 'GAME_MESSAGE',
        code,
        from: ws.playerId,
        data: msg.data,
      };
      broadcastToLobby(lobby, payload, ws);
      return;
    }

    ws.send(JSON.stringify({ type: 'ERROR', message: 'Unknown message type' }));
  });

  ws.on('close', () => {
    leaveLobby(ws);
  });
});

server.listen(PORT, () => {
  console.log(`Ant Empire multiplayer server listening on port ${PORT}`);
});
