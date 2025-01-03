<svelte:options
  customElement={{ tag: "spotify-playstate-action", shadow: "none" }}
/>

<script>
  import { MeltCombo } from "@intechstudio/grid-uikit";
  import { onMount } from "svelte";
  let eventId = "";
  let currentCodeValue = "";
  let ref;

  const suggestions = [
    { info: "Toggle Play/Pause", value: "toggle" },
    { info: "Next", value: "next" },
    { info: "Previous", value: "previous" },
    { info: "Play", value: "play" },
    { info: "Pause", value: "pause" },
  ];

  function handleConfigUpdate(config) {
    const regex = /^gps\("package-spotify", "playstate", "*(.*?)"\)$/;
    if (currentCodeValue != config.script) {
      currentCodeValue = config.script;
      const match = config.script.match(regex);
      if (match) {
        eventId = match[1] ?? "";
      }
    }
  }

  onMount(() => {
    const event = new CustomEvent("updateConfigHandler", {
      bubbles: true,
      detail: { handler: handleConfigUpdate },
    });
    ref.dispatchEvent(event);
  });

  $: eventId &&
    (function () {
      var code = `gps("package-spotify", "playstate", "${eventId}")`;
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

<spotify-playstate
  class="{$$props.class} flex flex-col w-full pb-2 px-2 pointer-events-auto"
  bind:this={ref}
>
  <div class="w-full flex">
    <MeltCombo
      title={"Playstate Action"}
      bind:value={eventId}
      {suggestions}
      searchable={true}
      size={"full"}
    />
  </div>
</spotify-playstate>
