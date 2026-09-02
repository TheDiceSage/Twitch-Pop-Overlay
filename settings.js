// Persistent overlay configuration. Edit these values, then reload index.html.
window.OVERLAY_SETTINGS = {
  "channel": "thedicesage",
  "groups": [
    {
      "id": "Resources",
      "command": "!gather",
      "images": [""],
      "popAnimation": "",
      "popAnimationDuration": 600,
      "popSound": "",
      "popSoundVolume": 100
    }
  ],
  "minInterval": 5,
  "maxInterval": 15,
  "size": 80,
  "maxImages": 6,
  "removalOrder": "oldest",
  "showHint": true,
  "streamerbot": {
    "enabled": false,
    "host": "127.0.0.1",
    "port": 8080,
    "actionName": "ImagePop"
  }
};