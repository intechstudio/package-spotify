<svelte:options customElement={{ tag: "spotify-preference", shadow: "none" }} />

<script>
  import {
    Block,
    BlockBody,
    BlockRow,
    BlockTitle,
    MoltenButton,
    MoltenInput,
  } from "@intechstudio/grid-uikit";
  import { onMount } from "svelte";

  let email = "";
  $: currentlyConnected = (email ?? "") !== "";

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

  onMount(() => {
    messagePort.onmessage = (e) => {
      const data = e.data;
      if (data.type === "status") {
        email = data.email;
      }
    };
    messagePort.start();
    return () => {
      messagePort.close();
    };
  });
</script>

<main-app>
  <div class="px-4">
    <Block>
      <BlockTitle>
        <div class="flex flex-row content-center">
          Spotify Preference <div
            style="margin-left: 12px; width: 12px; height: 12px; border-radius: 50%; background-color: {currentlyConnected
              ? '#00D248'
              : '#fb2323'}"
          />
        </div>
      </BlockTitle>
      {#if currentlyConnected}
        <BlockBody>
          Signed in as: {email}
        </BlockBody>
        <MoltenButton title={"Sign out"} click={logoutUser} />
      {:else}
        <MoltenButton title={"Authorize"} click={authorizeUser} />
      {/if}
    </Block>
  </div>
</main-app>
