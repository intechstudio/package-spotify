<svelte:options customElement={{ tag: "spotify-preference", shadow: "none" }} />

<script>
  import {
    Block,
    BlockBody,
    BlockTitle,
    MoltenPushButton,
    MeltCheckbox,
    MeltCombo
  } from "@intechstudio/grid-uikit";
  import { onMount } from "svelte";

  let email = "";
  let imageScale = "3";
  let automaticallySendImage = false;
  let messageQueTimeout = "180";
  let spotifyFetchIntervalTime = "5000"
  let isInitialized = false;
  let isPlaying = false;
  let currentTrackLength = 0;
  let currentTrackProgress = 0;
  let currentTrackName = "";
  let currentTrackArtist = "";
  $: currentlyConnected = (email ?? "") !== "";

  $: clientStatusLabel = currentlyConnected ? "Connected" : "Authorize";
  $: clientStatusIconColor = {
    "authorize" : "#4f4f4f",
    "error" : "#fb2323",
    "connected" : "#00D248" 
  }[currentlyConnected ? "connected" : "authorize"]

  // @ts-ignore
  const messagePort = createPackageMessagePort("package-spotify", "preference");

  function authorizeUser() {
    messagePort.postMessage({
      type: "auth-spotify",
    });
  }

  function logoutUser() {
    messagePort.postMessage({
      type: "logout-user",
    });
  }

  function sendImage() {
    messagePort.postMessage({
      type: "send-image",
    });
  }

  $: imageScale,  messageQueTimeout, automaticallySendImage, spotifyFetchIntervalTime, saveProperties();

  function saveProperties() {
    if (isInitialized){
      messagePort.postMessage({
        type: "save-properties",
        imageScale: imageScale,
        messageQueTimeout: Number(messageQueTimeout),
        automaticallySendImage,
        spotifyFetchIntervalTime: Number(spotifyFetchIntervalTime),
      });
    }
  }

  onMount(() => {
    messagePort.onmessage = (e) => {
      const data = e.data;
      if (data.type === "status") {
        email = data.email;
        messageQueTimeout = String(data.messageQueTimeout);
        automaticallySendImage = data.automaticallySendImage;
        imageScale = data.imageScale;
        spotifyFetchIntervalTime = String(data.spotifyFetchIntervalTime);
        isInitialized = true;
        currentTrackArtist = data.currentTrackArtist;
        currentTrackLength = data.currentTrackLength;
        currentTrackName = data.currentTrackName;
        currentTrackProgress = data.currentTrackProgress;
      }
    };
    messagePort.start();
    return () => {
      messagePort.close();
    };
  });

  function sendSpotifyControl(event){
    messagePort.postMessage({
        type: "play-control",
        args: ["playstate", event]
      });
  }

  function formatPlayTime(time){
    let seconds = time % 60;
    let minutes = Math.floor(time / 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`
  }
</script>

<main-app>
  <div class="px-4 bg-secondary rounded-lg">
    <Block>
      <BlockTitle>
        <div class="flex flex-row items-center">
          <div class="spotify-container">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" viewBox="0 0 496 512">
              <path fill="#1ed760" d="M248 8C111.1 8 0 119.1 0 256s111.1 248 248 248 248-111.1 248-248S384.9 8 248 8Z"/>
              <path d="M406.6 231.1c-5.2 0-8.4-1.3-12.9-3.9-71.2-42.5-198.5-52.7-280.9-29.7-3.6 1-8.1 2.6-12.9 2.6-13.2 0-23.3-10.3-23.3-23.6 0-13.6 8.4-21.3 17.4-23.9 35.2-10.3 74.6-15.2 117.5-15.2 73 0 149.5 15.2 205.4 47.8 7.8 4.5 12.9 10.7 12.9 22.6 0 13.6-11 23.3-23.2 23.3zm-31 76.2c-5.2 0-8.7-2.3-12.3-4.2-62.5-37-155.7-51.9-238.6-29.4-4.8 1.3-7.4 2.6-11.9 2.6-10.7 0-19.4-8.7-19.4-19.4s5.2-17.8 15.5-20.7c27.8-7.8 56.2-13.6 97.8-13.6 64.9 0 127.6 16.1 177 45.5 8.1 4.8 11.3 11 11.3 19.7-.1 10.8-8.5 19.5-19.4 19.5zm-26.9 65.6c-4.2 0-6.8-1.3-10.7-3.6-62.4-37.6-135-39.2-206.7-24.5-3.9 1-9 2.6-11.9 2.6-9.7 0-15.8-7.7-15.8-15.8 0-10.3 6.1-15.2 13.6-16.8 81.9-18.1 165.6-16.5 237 26.2 6.1 3.9 9.7 7.4 9.7 16.5s-7.1 15.4-15.2 15.4z"/>
            </svg>
          </div>
          <p class="font-medium text-lg pl-2 grow">Spotify</p>
          <div class="status-indicator" style="background-color: {clientStatusIconColor};" />
          <p class="text-gray-400">{clientStatusLabel}</p>

        </div>
      </BlockTitle>
      {#if currentlyConnected}
        <BlockBody>
          Signed in as: {email}
        </BlockBody>
        <MoltenPushButton snap="full" text="Sign out" click={logoutUser} />
        <BlockTitle>
          Currently playing
        </BlockTitle>
        <BlockBody>
          <div class="text-white flex flex-row">
            <div class="grow">
            {currentTrackName} 
            </div>  
            {#if currentTrackLength != 0}
              {formatPlayTime(currentTrackProgress)} / {formatPlayTime(currentTrackLength)}
            {/if}       
          </div>
          <div class="text-sm text-gray-400">
            {currentTrackArtist}
          </div>
          <div class="flex flex-row">
            <MoltenPushButton snap="full" text="Prev" click={() => sendSpotifyControl("previous")} />
            <MoltenPushButton snap="full" text="Pause" click={() => sendSpotifyControl("pause")} />
            <MoltenPushButton snap="full" text="Play" click={() => sendSpotifyControl("play")} />
            <MoltenPushButton snap="full" text="Next" click={() => sendSpotifyControl("next")} />
          </div>
        </BlockBody>
        
        <BlockTitle>
          Developer Settings
        </BlockTitle>
        <BlockBody>
          <MeltCombo
            title="Spotify fetch interval time"
            bind:value={spotifyFetchIntervalTime} />
          <MoltenPushButton snap="full" text="Send Album Image" click={sendImage} />
          <MeltCheckbox
            title="Automatically send image on album change"
            bind:target={automaticallySendImage}
          />
          <MeltCombo
            title="Scale image"
            bind:value={imageScale} />
          <MeltCombo
            title="Message que timeout"
            bind:value={messageQueTimeout} />
        </BlockBody>
      {:else}
        <MoltenPushButton snap="full" text="Authorize" click={authorizeUser} />
      {/if}
    </Block>
  </div>
</main-app>

<style>
  .spotify-container {
    width: 36px;
    height: 36px;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: black;
    border-radius: 4px;
  }

  .status-indicator {
    width: 12px;
    height: 12px;
    border-radius: 8px;
    margin: 8px;
  }
</style>
