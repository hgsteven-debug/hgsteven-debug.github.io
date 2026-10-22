// TURN ICE servers. Swap this file when the account or hostnames change.
// Credentials stay here so the game can reach the relay. Do not log them.
// ice.js keeps iceTransportPolicy "all", so a same-LAN host pair still wins.
// MQTT is only used after WebRTC, including this TURN list, fails.

export const TURN_ICE_SERVERS = [
  {
    "urls": "stun:stun.relay.metered.ca:80"
  },
  {
    "urls": "turn:global.relay.metered.ca:80",
    "username": "3161f873f3d7cf3219321ec4",
    "credential": "KK47LSDrYeCRjEHN"
  },
  {
    "urls": "turn:global.relay.metered.ca:80?transport=tcp",
    "username": "3161f873f3d7cf3219321ec4",
    "credential": "KK47LSDrYeCRjEHN"
  },
  {
    "urls": "turn:global.relay.metered.ca:443",
    "username": "3161f873f3d7cf3219321ec4",
    "credential": "KK47LSDrYeCRjEHN"
  },
  {
    "urls": "turns:global.relay.metered.ca:443?transport=tcp",
    "username": "3161f873f3d7cf3219321ec4",
    "credential": "KK47LSDrYeCRjEHN"
  }
];
