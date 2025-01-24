const fs = require("fs");
const path = require("path");
const polka = require("polka");
const crypto = require("crypto");
const SpotifyWebApi = require("spotify-web-api-node");

let open = undefined;

let isEnabled = false;
let controller = undefined;
let messagePorts = new Set();
let preferencePort = undefined;

let polkaServer = undefined;

const clientId = "29315a1d2ed24d78ac871eb8939090fd";
const redirectUri = "http://localhost:3845/callback";

const spotifyApi = new SpotifyWebApi({
  clientId: clientId,
  redirectUri: redirectUri,
});
let userEmail = "";
let refreshTokenIntervalId;

let actionId = 0;

exports.loadPackage = async function (gridController, persistedData) {
  controller = gridController;

  let spotifyIconSvg = fs.readFileSync(
    path.resolve(__dirname, "spotify-logo-black.svg"),
    { encoding: "utf-8" },
  );

  if (persistedData) {
    spotifyApi.setRefreshToken(persistedData.refreshToken);
    try {
      await refreshSpotifyToken();
      let me = await spotifyApi.getMe();
      userEmail = me.body.email;
      notifyPreference();
      refreshTokenIntervalId = setInterval(refreshSpotifyToken, 1000 * 60 * 50);
    } catch (e) {
      console.error(e);
    }
  }

  gridController.sendMessageToEditor({
    type: "add-action",
    info: {
      actionId: actionId++,
      short: "xsps",
      displayName: "Playstate",
      defaultLua: 'gps("package-spotify", "playstate", "toggle")',
      rendering: "standard",
      category: "spotify",
      color: "#1DB954",
      icon: spotifyIconSvg,
      blockIcon: spotifyIconSvg,
      selectable: true,
      movable: true,
      hideIcon: false,
      type: "single",
      toggleable: true,
      actionComponent: "spotify-playstate-action",
    },
  });

  gridController.sendMessageToEditor({
    type: "add-action",
    info: {
      actionId: actionId++,
      short: "xslc",
      displayName: "Like Action",
      defaultLua: 'gps("package-spotify", "like", "liked")',
      rendering: "standard",
      category: "spotify",
      color: "#1DB954",
      icon: spotifyIconSvg,
      blockIcon: spotifyIconSvg,
      selectable: true,
      movable: true,
      hideIcon: false,
      type: "single",
      toggleable: true,
      actionComponent: "spotify-like-current-action",
    },
  });

  open = (await import("open")).default;
  isEnabled = true;
};

exports.unloadPackage = async function () {
  clearInterval(refreshTokenIntervalId);
  while (--actionId >= 0) {
    controller.sendMessageToEditor({
      type: "remove-action",
      actionId,
    });
  }
  controller = undefined;
  if (polkaServer) {
    polkaServer.server.close();
  }
  polkaServer = undefined;
  messagePorts.forEach((port) => port.close());
  messagePorts.clear();
};

exports.addMessagePort = async function (port, senderId) {
  messagePorts.add(port);
  port.postMessage({
    type: "clientInit",
    message: {},
  });
  port.on("close", () => {
    messagePorts.delete(port);
    if (port === preferencePort) {
      preferencePort = undefined;
    }
  });
  if (senderId === "preference") {
    preferencePort = port;
    port.on("message", (e) => onPreferenceMessage(e.data));
    notifyPreference();
  }
  if (senderId === "like-action") {
    port.on("message", (e) => onActionMessage(port, e.data));
  }

  port.start();
};

exports.sendMessage = async function (args) {
  let type = args[0];
  try {
    if (type === "playstate") {
      let eventId = args[1];
      if (eventId === "pause") {
        await spotifyApi.pause();
      }
      if (eventId === "play") {
        await spotifyApi.play();
      }
      if (eventId === "next") {
        await spotifyApi.skipToNext();
      }
      if (eventId === "previous") {
        await spotifyApi.skipToPrevious();
      }
      if (eventId === "toggle") {
        let currentState = await spotifyApi.getMyCurrentPlaybackState();
        if (currentState.body.is_playing) {
          await spotifyApi.pause();
        } else {
          await spotifyApi.play();
        }
      }
    }
    if (type === "like" || type === "remove" || type === "toggle") {
      let currentState = await spotifyApi.getMyCurrentPlaybackState();
      let currentTrackId = currentState?.body?.item?.id;
      let playlistId = args[1];
      if (currentTrackId) {
        if (playlistId === "liked") {
          if (type === "toggle") {
            let currentStatus = await spotifyApi.containsMySavedTracks([
              currentTrackId,
            ]);
            let isSaved = currentStatus.body[0];
            type = isSaved ? "remove" : "like";
          }
          if (type === "like") {
            await spotifyApi.addToMySavedTracks([currentTrackId]);
          }
          if (type === "remove") {
            await spotifyApi.removeFromMySavedTracks([currentTrackId]);
          }
        } else {
          if (type === "toggle") {
            let trackIds = new Set();
            let counter = 0;
            let total = 0;
            do {
              let result = await spotifyApi.getPlaylistTracks(playlistId, {
                limit: 100,
                offset: counter,
                fields: "items(track.id), total, limit",
              });
              let items = result.body.items;
              items.forEach((item) => trackIds.add(item.track.id));
              total = result.body.total;
              counter += items.length;
              if (items.length === 0) break;
            } while (counter < total);
            type = trackIds.has(currentTrackId) ? "remove" : "like";
          }
          if (type === "like") {
            await spotifyApi.addTracksToPlaylist(playlistId, [
              `spotify:track:${currentTrackId}`,
            ]);
          } else if (type === "remove") {
            await spotifyApi.removeTracksFromPlaylist(playlistId, [
              { uri: `spotify:track:${currentTrackId}` },
            ]);
          }
        }
      }
    }
  } catch (e) {
    console.error(e);
  }
};

function generateRandomString(length) {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], "");
}

async function onActionMessage(port, data) {
  if (data.type === "request-playlists") {
    let playlists = [];
    let total = 0;
    do {
      let playlistResponse = await spotifyApi.getUserPlaylists({
        offset: playlists.length,
      });
      playlists.push(...playlistResponse.body.items);
      total = playlistResponse.body.total;
      if (playlistResponse.body.items.length === 0) break;
    } while (playlists.length < total);
    port.postMessage({
      type: "playlists",
      playlistSuggestions: playlists.map((e) => {
        return { info: e.name, value: e.id };
      }),
    });
  }
}

async function onPreferenceMessage(data) {
  if (data.type === "auth-spotify") {
    authorizeSpotify();
  }
  if (data.type === "logout-user") {
    spotifyApi.resetCredentials();
    clearInterval(refreshTokenIntervalId);
    userEmail = "";
    controller.sendMessageToEditor({
      type: "persist-data",
      data: undefined,
    });
    notifyPreference();
  }
}

function notifyPreference() {
  if (!preferencePort) return;

  preferencePort.postMessage({
    type: "status",
    email: userEmail,
  });
}

async function refreshSpotifyToken() {
  let refreshToken = spotifyApi.getRefreshToken();
  const payload = {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  };
  const body = await fetch("https://accounts.spotify.com/api/token", payload);
  const response = await body.json();
  spotifyApi.setAccessToken(response.access_token);
  if (response.refresh_token) {
    spotifyApi.setRefreshToken(response.refresh_token);
    controller.sendMessageToEditor({
      type: "persist-data",
      data: {
        refreshToken: response.refresh_token,
      },
    });
  }
}

async function authorizeSpotify() {
  let scope =
    "user-read-playback-state " +
    "user-modify-playback-state " +
    "user-read-email " +
    "user-library-read " +
    "user-library-modify " +
    "playlist-read-private " +
    "playlist-read-collaborative " +
    "playlist-modify-private " +
    "playlist-modify-public";

  const codeVerifier = generateRandomString(64);
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const authUrl = new URL("https://accounts.spotify.com/authorize");
  const params = {
    response_type: "code",
    client_id: clientId,
    scope,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
    redirect_uri: redirectUri,
  };
  authUrl.search = new URLSearchParams(params).toString();

  if (polkaServer) {
    polkaServer.server.close();
  }
  polkaServer = polka()
    .get("/callback", async (req, res) => {
      if (req.query.code) {
        const payload = {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: clientId,
            grant_type: "authorization_code",
            code: req.query.code,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier,
          }),
        };
        const body = await fetch(
          "https://accounts.spotify.com/api/token",
          payload,
        );
        const response = await body.json();
        if (response.access_token) {
          spotifyApi.setAccessToken(response.access_token);
          spotifyApi.setRefreshToken(response.refresh_token);
          controller.sendMessageToEditor({
            type: "persist-data",
            data: {
              refreshToken: response.refresh_token,
            },
          });
          let result = await spotifyApi.getMe();
          userEmail = result.body.email;
          clearInterval(refreshTokenIntervalId);
          refreshTokenIntervalId = setInterval(
            refreshSpotifyToken,
            1000 * 60 * 50,
          );
          notifyPreference();
        }
        res.end(`<script>window.close();</script>`);
      } else {
        res.end(`Permission denied!`);
      }
      polkaServer.server.close();
      polkaServer = undefined;
    })
    .listen(3845, (err) => {
      if (err) throw err;
      console.log("Running on localhost:3845");
    });
  open(authUrl.toString());
}
