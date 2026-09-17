import { mountArchive } from "./archiveView";

mountArchive(document, {
  load: () => chrome.runtime.sendMessage({ type: "GET_ARCHIVE_STATE" }),
  updateThemes: (lightTheme, darkTheme) => chrome.runtime.sendMessage({ type: "UPDATE_ARCHIVE_THEMES", lightTheme, darkTheme })
});
