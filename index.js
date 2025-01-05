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

const clientId = "7f6c2efb2c5244af80d14c4cdbc0253c";
const redirectUri = "http://localhost:8888/callback";

const spotifyApi = new SpotifyWebApi({
  clientId: clientId,
  redirectUri: redirectUri,
});
let userEmail = "";
let actionId = 0;

exports.loadPackage = async function (gridController, persistedData) {
  controller = gridController;

  let spotifyIconSvg = fs.readFileSync(
    path.resolve(__dirname, "spotify-logo-black.svg"),
    { encoding: "utf-8" },
  );

  if (persistedData) {
    spotifyApi.setAccessToken(persistedData.accessToken);
    spotifyApi.setRefreshToken(persistedData.refreshToken);
    try {
      let me = await spotifyApi.getMe();
      userEmail = me.body.email;
      notifyPreference();
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
      defaultLua: 'gps("package-spotify", "likecurrent", "like")',
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
  port.on("message", (e) => {
    onMessage(port, e.data);
  });

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
    notifyPreference();
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
    if (type === "likecurrent") {
      let currentState = await spotifyApi.getMyCurrentPlaybackState();
      let currentTrackId = currentState?.body?.item?.id;
      if (currentTrackId) {
        let eventId = args[1];
        if (eventId === "toggle") {
          let currentStatus = await spotifyApi.containsMySavedTracks([
            currentTrackId,
          ]);
          let isSaved = currentStatus.body[0];
          eventId = isSaved ? "remove" : "like";
        }
        if (eventId === "like") {
          await spotifyApi.addToMySavedTracks([currentTrackId]);
        }
        if (eventId === "remove") {
          await spotifyApi.removeFromMySavedTracks([currentTrackId]);
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

async function onMessage(port, data) {
  if (data.type === "auth-spotify") {
    authorizeSpotify();
  }
  if (data.type === "logout-user") {
    spotifyApi.resetCredentials();
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

async function authorizeSpotify() {
  let scope =
    "user-read-playback-state user-modify-playback-state user-read-email user-library-read user-library-modify";
  let state = "some-state-of-my-choice";

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
    state,
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
              accessToken: response.access_token,
              refreshToken: response.refresh_token,
            },
          });
          let result = await spotifyApi.getMe();
          userEmail = result.body.email;
          notifyPreference();
        }
        res.end(`Success!`);
      } else {
        res.end(`Permission denied!`);
      }
      polkaServer.server.close();
      polkaServer = undefined;
    })
    .listen(8888, (err) => {
      if (err) throw err;
      console.log("Running on localhost:8888");
    });
  open(authUrl.toString());
}
