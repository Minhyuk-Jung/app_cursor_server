/** @type {import("expo/config").ExpoConfig} */
const appJson = require("./app.json");

module.exports = () => ({
  expo: {
    ...appJson.expo,
    extra: {
      ...appJson.expo.extra,
      /** CI Maestro device E2E — 알림 권한 팝업·푸시 등록 skip */
      maestroE2e: process.env.EXPO_PUBLIC_MAESTRO_E2E === "1",
    },
  },
});
