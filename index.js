const fs = require("fs");
const path = require("path");
const polka = require("polka");
const crypto = require("crypto");
const SpotifyWebApi = require("spotify-web-api-node");
const { Jimp, ResizeStrategy } = require("jimp");

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
let updateTrackProgressId;

let latestImageUrl;

let messageQue = [];
let messageQueTimeoutId = undefined;
let messageQueTimeout = 180;
let imageScale = 3;
let streamInHigherQuality = false;
let automaticallySendImage = false;

let spotifyFetchTimeoutId = undefined;
let spotifyFetchIntervalTime = 5 * 1000;

function queMessage(message, priority) {
  if (priority) {
    messageQue.unshift(message);
  } else {
    messageQue.push(message);
  }
  if (messageQueTimeoutId === undefined) {
    sendNextMessage();
  }
}

function sendNextMessage() {
  clearTimeout(messageQueTimeoutId);
  messageQueTimeoutId = undefined;
  let message = messageQue.shift();
  if (!message) return;

  controller.sendMessageToEditor(message);
  messageQueTimeoutId = setTimeout(sendNextMessage, messageQueTimeout);
}

exports.loadPackage = async function (gridController, persistedData) {
  controller = gridController;

  let spotifyIconSvg = fs.readFileSync(
    path.resolve(__dirname, "spotify-logo-black.svg"),
    { encoding: "utf-8" },
  );

  if (persistedData) {
    messageQueTimeout = persistedData.messageQueTimeout ?? 180;
    imageScale = persistedData.imageScale ?? 3;
    automaticallySendImage = persistedData.automaticallySendImage ?? false;
    streamInHigherQuality = persistedData.streamInHigherQuality ?? false;
    spotifyFetchIntervalTime =
      persistedData.spotifyFetchIntervalTime ?? 5 * 1000;

    spotifyApi.setRefreshToken(persistedData.refreshToken);
    try {
      await refreshSpotifyToken();
      let me = await spotifyApi.getMe();
      userEmail = me.body.email;
      notifyPreference();
      refreshTokenIntervalId = setInterval(refreshSpotifyToken, 1000 * 60 * 50);
      fetchCurrentPlaybackState();
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
  clearTimeout(spotifyFetchTimeoutId);
  clearTimeout(messageQueTimeoutId);
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
  clearTimeout(updateTrackProgressId);
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
    if (type == "send-album") {
      scheduleAlbumCoverTransmit();
    }
    if (type === "playstate") {
      let eventId = args[1];
      if (eventId === "toggle") {
        //let currentState = await spotifyApi.getMyCurrentPlaybackState();
        eventId = isPlaying ? "pause" : "play";
      }
      if (eventId === "pause") {
        isPlaying = false;
        //updateEditorPlaybackState();
        await spotifyApi.pause();
      }
      if (eventId === "play") {
        isPlaying = true;
        //updateEditorPlaybackState();
        await spotifyApi.play();
      }
      if (eventId === "next") {
        await spotifyApi.skipToNext();
      }
      if (eventId === "previous") {
        await spotifyApi.skipToPrevious();
      }
    }
    if (type === "like" || type === "remove" || type === "toggle") {
      let currentState = await spotifyApi.getMyCurrentPlaybackState();
      let currentTrackId = currentState?.body?.item?.id;
      let playlistId = args[1];
      if (currentTrackId) {
        if (playlistId === "liked") {
          if (type === "toggle") {
            /*let currentStatus = await spotifyApi.containsMySavedTracks([
              currentTrackId,
            ]);
            let isSaved = currentStatus.body[0];*/
            let isSaved = currentTrackLiked;
            type = isSaved ? "remove" : "like";
          }
          if (type === "like") {
            currentTrackLiked = true;
            updateEditorPlaybackState();
            await spotifyApi.addToMySavedTracks([currentTrackId]);
            fetchCurrentPlaybackState();
          }
          if (type === "remove") {
            currentTrackLiked = false;
            updateEditorPlaybackState();
            await spotifyApi.removeFromMySavedTracks([currentTrackId]);
            fetchCurrentPlaybackState();
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

let currentTrackName = "";
let currentTrackArtist = "";
let currentTrackProgress = undefined;
let currentTrackLength = undefined;
let currentTrackLiked = false;
let isPlaying = false;

let lastSpotifyStateString;
function updateEditorPlaybackState() {
  if (isPlaying && updateTrackProgressId === undefined) {
    updateTrackProgressId = setTimeout(increaseTrackProgress, 1000);
  }

  let script = `spotify_play_callback('${currentTrackName.replace("'", "\\\'")}','${currentTrackArtist}',${currentTrackProgress},${currentTrackLength},${currentTrackLiked},${isPlaying})`;
  if (lastSpotifyStateString == script) return;

  lastSpotifyStateString = script;
  queMessage(
    {
      type: "execute-lua-script",
      script,
    },
    true,
  );
}

function increaseTrackProgress() {
  currentTrackProgress++;
  updateTrackProgressId = undefined;
  updateEditorPlaybackState();
}

let imageString;
let latestScaleSize = undefined;
const maxCharacterCount = 376;
async function scheduleAlbumCoverTransmit() {
  messageQue = [];
  if (latestScaleSize != imageScale) {
    latestScaleSize = imageScale;
    queMessage(
      {
        type: "execute-lua-script",
        script: `setscale(${latestScaleSize})`,
      },
      false,
    );
  }
  queMessage(
    {
      type: "execute-lua-script",
      script: `sit(0, "")`,
    },
    false,
  );

  let image = await Jimp.read(latestImageUrl);
  let highQualityImage;
  if (streamInHigherQuality) {
    highQualityImage = image.clone();
  }

  const imageSize = 120 / latestScaleSize;
  image.resize({ w: imageSize, h: imageSize });

  imageString = "";
  for (let i = 0; i < imageSize; i++) {
    for (let j = 0; j < imageSize; j++) {
      let pixel = image.getPixelColor(j, i);
      const r = (pixel >> 24) & 0xff;
      const g = (pixel >> 16) & 0xff;
      const b = (pixel >> 8) & 0xff;

      const buffer = Buffer.from([r, g, b]);

      imageString += buffer.toString("base64");
    }
  }

  let imageIndex = 0;
  let imagePart = "";
  do {
    imagePart = imageString.substring(
      imageIndex * maxCharacterCount,
      (imageIndex + 1) * maxCharacterCount,
    );
    queMessage(
      {
        type: "execute-lua-script",
        script: `sit(${imageIndex},"${imagePart}")`,
      },
      false,
    );
    imageIndex++;
  } while (imagePart.length == maxCharacterCount);

  if (streamInHigherQuality && latestScaleSize != 1) {
    latestScaleSize = 1;
    queMessage({
      type: "execute-lua-script",
      script: `setscale(${latestScaleSize})`,
    });

    const highImageSize = 120;
    highQualityImage.resize({ w: highImageSize, h: highImageSize });

    imageString = "";
    for (let i = 0; i < highImageSize; i++) {
      for (let j = 0; j < highImageSize; j++) {
        let pixel = highQualityImage.getPixelColor(j, i);
        const r = (pixel >> 24) & 0xff;
        const g = (pixel >> 16) & 0xff;
        const b = (pixel >> 8) & 0xff;

        const buffer = Buffer.from([r, g, b]);

        imageString += buffer.toString("base64");
      }
    }

    imageIndex = 0;
    do {
      imagePart = imageString.substring(
        imageIndex * maxCharacterCount,
        (imageIndex + 1) * maxCharacterCount,
      );
      queMessage(
        {
          type: "execute-lua-script",
          script: `sit(${imageIndex},"${imagePart}")`,
        },
        false,
      );
      imageIndex++;
    } while (imagePart.length == maxCharacterCount);
  }
}

async function fetchCurrentPlaybackState() {
  try {
    let currentStateResponse = await spotifyApi.getMyCurrentPlaybackState();
    let currentState = currentStateResponse.body;
    currentTrackName = currentState?.item?.name ?? "";
    currentTrackArtist = currentState?.item?.artists[0]?.name ?? "";
    currentTrackProgress = Math.floor((currentState?.progress_ms ?? 0) / 1000);
    currentTrackLength = Math.floor(
      (currentState?.item?.duration_ms ?? 0) / 1000,
    );
    isPlaying = currentState?.is_playing ?? false;
    let currentStatus = await spotifyApi.containsMySavedTracks([
      currentState?.item?.id,
    ]);
    let isSaved = currentStatus.body[0] ?? false;
    currentTrackLiked = isSaved;
    clearTimeout(updateTrackProgressId);
    updateTrackProgressId = undefined;
    updateEditorPlaybackState();
    let trackImage = (currentState?.item?.album?.images ?? [])[0]?.url;
    if (latestImageUrl != trackImage) {
      latestImageUrl = trackImage;
      if (automaticallySendImage) {
        scheduleAlbumCoverTransmit();
      }
    }
  } catch (e) {
    console.error(e);
  }
  clearTimeout(spotifyFetchTimeoutId);
  spotifyFetchTimeoutId = setTimeout(
    fetchCurrentPlaybackState,
    Math.max(50, spotifyFetchIntervalTime),
  );
}

async function onActionMessage(port, data) {
  try {
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
  } catch (e) {
    console.error(e);
  }
}

async function onPreferenceMessage(data) {
  if (data.type === "auth-spotify") {
    authorizeSpotify();
  }
  if (data.type === "logout-user") {
    spotifyApi.resetCredentials();
    clearInterval(refreshTokenIntervalId);
    clearTimeout(spotifyFetchTimeoutId);
    userEmail = "";
    controller.sendMessageToEditor({
      type: "persist-data",
      data: {
        refreshToken: undefined,
        messageQueTimeout,
        imageScale,
        automaticallySendImage,
        streamInHigherQuality,
        spotifyFetchIntervalTime,
      },
    });
    notifyPreference();
  }
  if (data.type === "send-image") {
    scheduleAlbumCoverTransmit();
  }
  if (data.type === "save-properties") {
    messageQueTimeout = data.messageQueTimeout;
    imageScale = data.imageScale;
    automaticallySendImage = data.automaticallySendImage;
    streamInHigherQuality = data.streamInHigherQuality;
    spotifyFetchIntervalTime = data.spotifyFetchIntervalTime;

    controller.sendMessageToEditor({
      type: "persist-data",
      data: {
        refreshToken: spotifyApi.getRefreshToken(),
        messageQueTimeout,
        imageScale,
        automaticallySendImage,
        streamInHigherQuality,
        spotifyFetchIntervalTime,
      },
    });
  }
}

function notifyPreference() {
  if (!preferencePort) return;

  preferencePort.postMessage({
    type: "status",
    email: userEmail,
    messageQueTimeout,
    imageScale,
    automaticallySendImage,
    streamInHigherQuality,
    spotifyFetchIntervalTime,
  });
}

function generateRandomString(length) {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], "");
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
        messageQueTimeout,
        imageScale,
        automaticallySendImage,
        streamInHigherQuality,
        spotifyFetchIntervalTime,
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
              messageQueTimeout,
              imageScale,
              automaticallySendImage,
              streamInHigherQuality,
              spotifyFetchIntervalTime,
            },
          });
          let result = await spotifyApi.getMe();
          userEmail = result.body.email;
          clearInterval(refreshTokenIntervalId);
          refreshTokenIntervalId = setInterval(
            refreshSpotifyToken,
            1000 * 60 * 50,
          );
          fetchCurrentPlaybackState();
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
