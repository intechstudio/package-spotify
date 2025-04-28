<svelte:options
  customElement={{ tag: "spotify-like-current-action", shadow: "none" }}
/>

<script>
  import { MeltCombo } from "@intechstudio/grid-uikit";
  import { onMount } from "svelte";
  let eventId = "";
  let playlistId = "";
  let currentCodeValue = "";
  let ref;

  const suggestions = [
    { info: "Like", value: "like" },
    { info: "Remove", value: "remove" },
    { info: "Toggle", value: "toggle" },
  ];

  let playlistSuggestions = [];

  // @ts-ignore
  const messagePort = createPackageMessagePort(
    "package-spotify",
    "like-action",
  );

  function handleConfigUpdate(config) {
    const regex = /^gps\("package-spotify", "*(.*?)", "*(.*?)"\)$/;
    if (currentCodeValue != config.script) {
      currentCodeValue = config.script;
      const match = config.script.match(regex);
      if (match) {
        eventId = match[1] ?? "";
        playlistId = match[2] ?? "";
      }
    }
  }

  onMount(() => {
    const event = new CustomEvent("updateConfigHandler", {
      bubbles: true,
      detail: { handler: handleConfigUpdate },
    });
    ref.dispatchEvent(event);
    messagePort.onmessage = (e) => {
      const data = e.data;
      if (data.type === "playlists") {
        playlistSuggestions = [
          { info: "Liked Songs", value: "liked" },
          ...data.playlistSuggestions,
        ];
      }
    };
    messagePort.start();
    messagePort.postMessage({
      type: "request-playlists",
    });
    return () => {
      messagePort.close();
    };
  });

  $: eventId &&
    playlistId &&
    (function () {
      var code = `gps("package-spotify", "${eventId}", "${playlistId}")`;
      if (currentCodeValue != code) {
        currentCodeValue = code;
        const event = new CustomEvent("updateCode", {
          bubbles: true,
          detail: { script: String(code) },
        });
        if (ref) {
          ref.dispatchEvent(event);
        }
      }
    })();
</script>

<spotify-likecurrent
  class="{$$props.class} flex flex-col w-full pb-2 px-2 pointer-events-auto"
  bind:this={ref}
>
  <div class="w-full flex">
    <div style="width: 30%; padding-right: 0.5rem">
      <MeltCombo
        title={"Action"}
        bind:value={eventId}
        {suggestions}
        searchable={true}
        size={"full"}
      />
    </div>
    <MeltCombo
      title={"Playlist"}
      bind:value={playlistId}
      suggestions={playlistSuggestions}
      searchable={true}
      size={"full"}
    />
  </div>
</spotify-likecurrent>
