# Twitch Pop Overlay [![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/thedicesage)


An OBS browser source overlay that connects to a Twitch channel's chat, spawns small images/GIFs along the bottom of the screen, and pops them when chat types a matching command.

## Files

You need all four of these **in the same folder**, plus `server.py` to save settings from the page:

- `index.html`
- `style.css`
- `settings.js`
- `script.js`
- `server.py`

## Quick start

1. Put all files into one folder (don't rename, don't separate).
2. Start the local server from that folder: `py server.py`
3. Open `http://127.0.0.1:8765` in your browser, or use that URL as the OBS Browser Source URL.
4. In OBS, add a **Browser Source** using the URL above and leave **Local file** unchecked.
5. Set the width/height to match your canvas (e.g. 1920x1080 or leave default and resize the source).
6. In the page or OBS preview, press **S** or click the small gear icon in the bottom-right corner to open Settings.

## Configuring

Open the settings panel (press **S**) and fill in:

- **Twitch Channel** - the channel whose chat it should listen to (e.g. `thedicesage` if it was my channel).
- **Group 1 / 2 / 3** - each group has:
  - The **pop command** (e.g. `!pop`) is what chat types to pop one of that group's images.
  - Up to 5 image or GIF URLs using direct links to hosted images. To make a specific image spawn less (or more) often, add |weight after its URL, e.g. "https://example.com/rare.gif|0.2". Weight defaults to 1 if omitted; a 0.2 weight spawns 5x less often than a default image, while a 3 would spawn 3x more often.
  - An optional **pop animation GIF** that plays where the image was when it's popped. Leave blank to use the default particle-burst effect. Set the duration (ms) to roughly match the GIF's real length.
  - An optional **pop sound effect** (direct link to an MP3/WAV/OGG) with its own volume that plays whenever chat pops an image from that group.
- **Min/max interval** - how often (in seconds) a new image spawns.
- **Image size** - display size in pixels with a 1:1 ratio.
- **Max on screen** - limits how many images can be up at once.
- **Pop order** - which image gets removed first when a command matches: oldest or random.
- **Show command hint** - displays a small on-screen reminder of the active commands.

Open the settings panel and click **Save & Connect**. The local server writes the values directly to `settings.js`, and they reload automatically next time. Use the per-group **Test Spawn** / **Test Pop** buttons to preview each group without needing live chat.

Once configured, close the panel by pressing **S** again. It's invisible to your stream when closed.

## Optional: Streamer.bot integration

If you want to track, per user, how many times they've popped a specific image:

1. In Streamer.bot: **Servers/Clients** -> **WebSocket Server** -> enable it (default port `8080`).
2. Create an **Action** named exactly `ImagePop` (or whatever you set below), no trigger needed.
3. Add an **Execute C# Code** sub-action:

```csharp
using System.Collections.Generic;

public class CPHInline
{
    public bool Execute()
    {
        CPH.TryGetArg("userId", out string userId);
        CPH.TryGetArg("imageId", out string imageId);

        if (string.IsNullOrEmpty(userId) || string.IsNullOrEmpty(imageId))
        {
            CPH.LogWarn("ImagePop: missing userId or imageId");
            return false;
        }

        string varName = $"pops_{imageId}";
        CPH.IncrementOrCreateTwitchUsersVarById(new List<string> { userId }, varName, 1, true);

        return true;
    }
}
```

## Troubleshooting

- **Images never appear**: make sure at least one group has image URLs configured, and that you hit Save & Connect.
- **Commands don't pop anything**: command matching is exact — `!pop` won't match `!pop please`. Check the status indicator in the panel shows "Connected to #yourchannel".
- **Streamer.bot not receiving events**: check the small status line under the Streamer.bot section of the panel, and confirm the Action name matches exactly (case-sensitive).
- **Settings panel shows on stream**: make sure it's closed by pressing S before adding/using the source in OBS — the gear icon is intentionally small and low-opacity, but you can crop it out in OBS or change opacity to zero if you'd like it fully gone.
